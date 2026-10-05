// NULLPUNKT — Spielerprofil: XP, Level (1–55), Dienstgrade, Statistiken, Match-Verlauf (§4).
// localStorage 'nullpunkt:profile'. Robust gegen fehlenden/gesperrten Speicher, validiert
// alles beim Laden, synchronisiert sich zwischen Tabs. Freischaltungen über
// WEAPONS[id].unlockLevel aus weapons.data.js, XP-Regeln aus modes.data.js (beide statisch importiert).

import { settings } from './settings.js';
import { WEAPONS, EQUIPMENT } from './weapons.data.js';
import { matchBonusXp, medalXp, DIFFICULTIES, XP_RULES, applyChallenges, blankChallenges } from './modes.data.js';

const STORAGE_KEY = 'nullpunkt:profile';
const VERSION = 1;
export const MAX_LEVEL = 55;
const HISTORY_MAX = 25;

/* ----------------------------------------------------------------- XP-Kurve */

// XP von Level l nach l+1: 300 (1→2), wächst linear + leicht quadratisch, auf 50 gerundet.
// Gesamt bis Level 55 ≈ 330 000 XP (≈ 120–180 Matches).
const LEVEL_XP = [0, 0]; // LEVEL_XP[l] = Gesamt-XP, um Level l zu erreichen
for (let l = 1; l < MAX_LEVEL; l++) {
  const step = Math.round((300 + 150 * (l - 1) + 2 * (l - 1) ** 2) / 50) * 50;
  LEVEL_XP[l + 1] = LEVEL_XP[l] + step;
}

/** Gesamt-XP, die für `level` nötig sind (Level 1 = 0). */
export function xpForLevel(level) {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)));
  return LEVEL_XP[l];
}

/** Level für eine XP-Summe (1…55). */
export function levelFor(xp) {
  const x = Math.max(0, Number(xp) || 0);
  let lo = 1;
  let hi = MAX_LEVEL;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (LEVEL_XP[mid] <= x) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Fortschritt innerhalb des aktuellen Levels. */
export function levelProgress(xp) {
  const level = levelFor(xp);
  const isMax = level >= MAX_LEVEL;
  const base = LEVEL_XP[level];
  const next = isMax ? base : LEVEL_XP[level + 1];
  const into = Math.max(0, (Number(xp) || 0) - base);
  return { level, isMax, xpIntoLevel: isMax ? 0 : into, xpForNext: isMax ? 0 : next - base, progress: isMax ? 1 : into / (next - base) };
}

/* -------------------------------------------------------------- Dienstgrade */

// tier: Laufbahngruppe – steuert das Abzeichen.
export const RANKS = Object.freeze([
  { id: 'rekrut', name: 'Rekrut', minLevel: 1, maxLevel: 2, tier: 'mannschaft', marks: 0 },
  { id: 'gefreiter', name: 'Gefreiter', minLevel: 3, maxLevel: 5, tier: 'mannschaft', marks: 1 },
  { id: 'obergefreiter', name: 'Obergefreiter', minLevel: 6, maxLevel: 8, tier: 'mannschaft', marks: 2 },
  { id: 'hauptgefreiter', name: 'Hauptgefreiter', minLevel: 9, maxLevel: 11, tier: 'mannschaft', marks: 3 },
  { id: 'stabsgefreiter', name: 'Stabsgefreiter', minLevel: 12, maxLevel: 14, tier: 'mannschaft', marks: 4 },
  { id: 'unteroffizier', name: 'Unteroffizier', minLevel: 15, maxLevel: 17, tier: 'unteroffizier', marks: 0 },
  { id: 'stabsunteroffizier', name: 'Stabsunteroffizier', minLevel: 18, maxLevel: 20, tier: 'unteroffizier', marks: 1 },
  { id: 'feldwebel', name: 'Feldwebel', minLevel: 21, maxLevel: 23, tier: 'feldwebel', marks: 1 },
  { id: 'oberfeldwebel', name: 'Oberfeldwebel', minLevel: 24, maxLevel: 26, tier: 'feldwebel', marks: 2 },
  { id: 'hauptfeldwebel', name: 'Hauptfeldwebel', minLevel: 27, maxLevel: 29, tier: 'feldwebel', marks: 3 },
  { id: 'stabsfeldwebel', name: 'Stabsfeldwebel', minLevel: 30, maxLevel: 32, tier: 'feldwebel', marks: 4 },
  { id: 'leutnant', name: 'Leutnant', minLevel: 33, maxLevel: 35, tier: 'offizier', marks: 1 },
  { id: 'oberleutnant', name: 'Oberleutnant', minLevel: 36, maxLevel: 38, tier: 'offizier', marks: 2 },
  { id: 'hauptmann', name: 'Hauptmann', minLevel: 39, maxLevel: 41, tier: 'offizier', marks: 3 },
  { id: 'major', name: 'Major', minLevel: 42, maxLevel: 45, tier: 'stabsoffizier', marks: 1 },
  { id: 'oberstleutnant', name: 'Oberstleutnant', minLevel: 46, maxLevel: 49, tier: 'stabsoffizier', marks: 2 },
  { id: 'oberst', name: 'Oberst', minLevel: 50, maxLevel: 54, tier: 'stabsoffizier', marks: 3 },
  { id: 'general', name: 'General', minLevel: 55, maxLevel: 55, tier: 'general', marks: 4 },
]);

/** Dienstgrad für ein Level: { id, name, minLevel, maxLevel, tier, index }. */
export function rankFor(level) {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)));
  const index = RANKS.findIndex((r) => l >= r.minLevel && l <= r.maxLevel);
  const r = RANKS[index < 0 ? 0 : index];
  return { ...r, index: index < 0 ? 0 : index };
}

/* Abzeichen: Schulterklappe (viewBox 0 0 32 32), Zeichnung in currentColor. */

function starPath(cx, cy, r) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * rr).toFixed(2)} ${(cy + Math.sin(a) * rr).toFixed(2)}`;
  }
  return `${d}Z`;
}

function stars(n, y0, gap = 6, r = 2.6) {
  let d = '';
  for (let i = 0; i < n; i++) d += starPath(16, y0 - i * gap, r);
  return `<path d="${d}" fill="currentColor" stroke="none"/>`;
}

const WREATH =
  '<path d="M9.5 27.5Q8 22 11 18.5 M22.5 27.5Q24 22 21 18.5" fill="none" stroke="currentColor" stroke-width="1.2"/>' +
  '<path d="M9.2 25.6l-1.8-1.3 M9 22.6l-1.9-.8 M10 19.9l-1.6-.4 M22.8 25.6l1.8-1.3 M23 22.6l1.9-.8 M22 19.9l1.6-.4" stroke="currentColor" stroke-width="1.3"/>';

/** Kleines Inline-SVG des Dienstgrad-Abzeichens (Farbe = currentColor; General in Gold). */
export function rankIcon(level, { size = 32, title = true } = {}) {
  const r = rankFor(level);
  let body = '';
  switch (r.tier) {
    case 'mannschaft': {
      if (r.marks === 0) body = '<path d="M11 21H21" stroke="currentColor" stroke-width="2.4"/>';
      else {
        // Schrägbalken (Winkel) von unten nach oben gestapelt.
        for (let i = 0; i < r.marks; i++) {
          const y = 25 - i * 4.6;
          body += `<path d="M10.5 ${y}L16 ${y - 3.4}L21.5 ${y}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="miter"/>`;
        }
      }
      break;
    }
    case 'unteroffizier':
      // Tresse (offen bzw. geschlossen)
      body = r.marks
        ? '<path d="M10 8V26H22V8Z" fill="none" stroke="currentColor" stroke-width="2"/>'
        : '<path d="M10 8V26H22V8" fill="none" stroke="currentColor" stroke-width="2"/>';
      break;
    case 'feldwebel':
      body = '<path d="M10 8V26H22V8Z" fill="none" stroke="currentColor" stroke-width="2"/>' +
        stars(Math.min(3, r.marks), 21.5, 6, 2.3) +
        (r.marks > 3 ? '<path d="M12 11H20" stroke="currentColor" stroke-width="1.6"/>' : '');
      break;
    case 'offizier':
      body = stars(r.marks, 23, 6.5, 2.8);
      break;
    case 'stabsoffizier':
      body = WREATH + stars(r.marks, 20, 6, 2.6);
      break;
    case 'general':
      body = WREATH + stars(3, 20, 5.6, 2.4) + '<path d="M12.5 27.5H19.5" stroke="currentColor" stroke-width="1.6"/>';
      break;
    default:
      break;
  }
  const color = r.tier === 'general' ? ' style="color:var(--np-gold,#FFC23D)"' : '';
  const label = `${r.name} (Level ${Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)))})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}" class="np-rank np-rank--${r.tier}" data-rank="${r.id}"${color} role="img" aria-label="${label}">` +
    (title ? `<title>${label}</title>` : '') +
    '<path d="M8 4.5Q16 1.5 24 4.5V29.5H8Z" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="1.2"/>' +
    body + '</svg>';
}

/* ---------------------------------------------------------- Freischaltungen */

// Freischaltlevel und Anzeigenamen aus weapons.data.js (WEAPONS[id].unlockLevel, EQUIPMENT[id].unlockLevel)
const unlockTable = {};
const unlockNames = {};
for (const src of [WEAPONS, EQUIPMENT]) {
  for (const [id, def] of Object.entries(src || {})) {
    if (def && Number.isFinite(def.unlockLevel)) unlockTable[id] = def.unlockLevel;
    if (def && def.name) unlockNames[id] = def.name;
  }
}

function unlockedBetween(before, after) {
  return Object.entries(unlockTable)
    .filter(([, lvl]) => lvl > before && lvl <= after)
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id);
}

/* ---------------------------------------------------------------- Speicher */

function getStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const s = window.localStorage;
    s.setItem('nullpunkt:__probe', '1');
    s.removeItem('nullpunkt:__probe');
    return s;
  } catch {
    return null;
  }
}
const storage = getStorage();

const num = (v, min = 0, max = 1e12) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
};
const int = (v, min = 0, max = 1e9) => Math.round(num(v, min, max));
const ID_RE = /^[a-z0-9_-]{1,32}$/;

function blank() {
  return {
    version: VERSION, name: settings.get('playerName') || 'Operator', xp: 0, level: 1,
    matches: 0, wins: 0, losses: 0, draws: 0, kills: 0, deaths: 0, assists: 0, headshots: 0,
    shotsFired: 0, shotsHit: 0, playtime: 0, bestStreak: 0, longestKill: 0,
    weaponStats: {}, modeStats: {}, medals: {}, history: [], createdAt: Date.now(), updatedAt: Date.now(),
    // modes-ui (additiv): Kosmetik, Herausforderungen, Geheimnisse, Zähler (Fahrzeuge, Marken, Infektionen …)
    cosmetics: { equipped: { weapon: {}, operator: {} } }, challenges: blankChallenges(), secrets: {}, counters: {},
  };
}

/** modes-ui: Kosmetik/Herausforderungen/Geheimnisse bereinigen (Ids, Größen begrenzt). */
function cleanExtras(p, data) {
  const idMap = (src, max = 200) => {
    const out = {};
    if (!src || typeof src !== 'object') return out;
    for (const [k, v] of Object.entries(src).slice(0, max)) if (ID_RE.test(k) && typeof v === 'string' && /^[a-z0-9_:-]{1,40}$/.test(v)) out[k] = v;
    return out;
  };
  const eq = data.cosmetics && data.cosmetics.equipped;
  p.cosmetics = { equipped: { weapon: idMap(eq && eq.weapon), operator: idMap(eq && eq.operator, 16) } };
  const ch = data.challenges && typeof data.challenges === 'object' ? data.challenges : null;
  if (ch) {
    const slot = (x) => (x && typeof x === 'object' && typeof x.key === 'string' && x.key.length < 16
      ? { key: x.key, prog: cleanCounts(x.prog), done: Array.isArray(x.done) ? x.done.filter((d) => ID_RE.test(d)).slice(0, 16) : [] }
      : { key: '', prog: {}, done: [] });
    p.challenges = { daily: slot(ch.daily), weekly: slot(ch.weekly), totals: cleanCounts(ch.totals), claimed: cleanCounts(ch.claimed) };
  }
  if (data.secrets && typeof data.secrets === 'object') {
    for (const [k, v] of Object.entries(data.secrets).slice(0, 64)) {
      if (ID_RE.test(k) && v && typeof v === 'object') p.secrets[k] = { name: String(v.name || k).slice(0, 48), map: ID_RE.test(v.map || '') ? v.map : '', at: int(v.at, 0, 1e15) };
    }
  }
  p.counters = cleanCounts(data.counters);
}

function cleanWeaponStats(src) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  for (const [id, s] of Object.entries(src)) {
    if (!ID_RE.test(id) || !s || typeof s !== 'object') continue;
    out[id] = { kills: int(s.kills), shots: int(s.shots), hits: int(s.hits), headshots: int(s.headshots) };
  }
  return out;
}

function cleanCounts(src) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  for (const [id, n] of Object.entries(src)) if (ID_RE.test(id)) out[id] = int(n);
  return out;
}

function sanitize(data) {
  const p = blank();
  if (!data || typeof data !== 'object') return p;
  p.name = typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 16) : p.name;
  p.xp = int(data.xp, 0, xpForLevel(MAX_LEVEL) * 4);
  p.level = levelFor(p.xp);
  for (const k of ['matches', 'wins', 'losses', 'draws', 'kills', 'deaths', 'assists', 'headshots', 'shotsFired', 'shotsHit', 'bestStreak']) p[k] = int(data[k]);
  p.playtime = num(data.playtime);
  p.longestKill = Math.round(num(data.longestKill, 0, 10000) * 10) / 10;
  p.weaponStats = cleanWeaponStats(data.weaponStats);
  p.medals = cleanCounts(data.medals);
  if (data.modeStats && typeof data.modeStats === 'object') {
    for (const [id, s] of Object.entries(data.modeStats)) {
      if (ID_RE.test(id) && s && typeof s === 'object') p.modeStats[id] = { matches: int(s.matches), wins: int(s.wins) };
    }
  }
  if (Array.isArray(data.history)) p.history = data.history.filter((h) => h && typeof h === 'object').slice(0, HISTORY_MAX);
  cleanExtras(p, data);
  p.createdAt = int(data.createdAt, 0, 1e15) || Date.now();
  p.updatedAt = int(data.updatedAt, 0, 1e15) || Date.now();
  return p;
}

function load() {
  if (!storage) return blank();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : blank();
  } catch {
    return blank();
  }
}

let data = load();
const listeners = new Set();

function save() {
  data.updatedAt = Date.now();
  if (!storage) return;
  try { storage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* gesperrt/voll */ }
}

function notify() {
  const snap = profile.get();
  for (const fn of [...listeners]) {
    try { fn(snap); } catch (err) { console.error('[NULLPUNKT] profile.onChange-Listener:', err); }
  }
}

/* ------------------------------------------------------------ XP-Vergabe */

const RESULT_LABEL = { win: 'Matchbonus (Sieg)', draw: 'Matchbonus (Unentschieden)', loss: 'Matchbonus (Niederlage)' };

function sanitizeSummary(s) {
  const result = ['win', 'loss', 'draw'].includes(s.result) ? s.result : 'loss';
  return {
    modeId: typeof s.modeId === 'string' && ID_RE.test(s.modeId) ? s.modeId : 'tdm',
    mapId: typeof s.mapId === 'string' && ID_RE.test(s.mapId) ? s.mapId : 'unbekannt',
    result,
    kills: int(s.kills, 0, 5000), deaths: int(s.deaths, 0, 5000), assists: int(s.assists, 0, 5000),
    headshots: int(s.headshots, 0, 5000), score: int(s.score, 0, 1e6),
    shotsFired: int(s.shotsFired, 0, 1e6), shotsHit: int(s.shotsHit, 0, 1e6),
    bestStreak: int(s.bestStreak, 0, 5000), longestKill: num(s.longestKill, 0, 10000),
    damage: int(s.damage, 0, 1e7), captures: int(s.captures, 0, 5000),
    medals: cleanCounts(s.medals), weaponStats: cleanWeaponStats(s.weaponStats),
    duration: num(s.duration, 0, 24 * 3600),
    difficulty: typeof s.difficulty === 'string' && ID_RE.test(s.difficulty) ? s.difficulty : null,
    counters: cleanCounts(s.counters), style: s.style === 'realistisch' ? 'realistisch' : 'arcade',
  };
}

/* ------------------------------------------------------------------- API */

export const profile = {
  maxLevel: MAX_LEVEL,
  /** Kompatibilität: Daten sind statisch importiert und damit sofort bereit. */
  ready: Promise.resolve(true),
  persistent: !!storage,

  /** Tiefe Kopie des Profils. */
  get() {
    return JSON.parse(JSON.stringify({ ...data, name: settings.get('playerName') || data.name }));
  },

  /**
   * Verbucht ein Match (playerSummary aus §9). Gibt den Fortschritt zurück:
   * { xpGained, levelBefore, levelAfter, xpBefore, xpAfter, unlocked:[ids], breakdown:[{id,label,xp}],
   *   rankBefore, rankAfter, levelUp, rankUp, progressBefore, progressAfter }
   */
  recordMatch(summary) {
    if (!summary || typeof summary !== 'object') return null;
    const s = sanitizeSummary(summary);
    const xpBefore = data.xp;
    const levelBefore = data.level;
    const training = s.modeId === 'training';

    const breakdown = [];
    const R = XP_RULES;
    if (training) {
      const f = Number.isFinite(R.trainingFactor) ? R.trainingFactor : 0.25;
      const max = Number.isFinite(R.trainingMax) ? R.trainingMax : 500;
      breakdown.push({ id: 'training', label: 'Schießstand', xp: Math.min(max, Math.round(s.score * f)) });
    } else {
      breakdown.push({ id: 'score', label: 'Punktzahl', xp: s.score });
      // Kurze (Test-)Matches geben anteilig weniger Matchbonus.
      const bonus = matchBonusXp(s.result, s.duration);
      breakdown.push({ id: 'result', label: RESULT_LABEL[s.result], xp: bonus });
      const medalCount = Object.values(s.medals).reduce((a, b) => a + b, 0);
      if (medalCount) breakdown.push({ id: 'medals', label: 'Medaillen', xp: medalXp(s.medals) });
      // Schwierigkeitsgrad (DIFFICULTIES[].xpMult)
      const diff = s.difficulty ? DIFFICULTIES[s.difficulty] : null;
      const mult = diff && Number.isFinite(diff.xpMult) ? diff.xpMult : 1;
      if (mult !== 1) {
        const sub = breakdown.reduce((a, b) => a + b.xp, 0);
        breakdown.push({ id: 'difficulty', label: `Schwierigkeit ${diff.name || s.difficulty} ×${String(mult).replace('.', ',')}`, xp: Math.round(sub * (mult - 1)) });
      }
    }
    // modes-ui: Herausforderungen (täglich/wöchentlich) und Meilensteine
    let challenges = [];
    if (!training) {
      const base = { kills: data.kills + s.kills, headshots: data.headshots + s.headshots, wins: data.wins + (s.result === 'win' ? 1 : 0),
        medals: Object.values(data.medals).reduce((a, b) => a + b, 0) + Object.values(s.medals).reduce((a, b) => a + b, 0) };
      const res = applyChallenges(data.challenges || (data.challenges = blankChallenges()), s, { base });
      challenges = res.completed;
      const chXp = challenges.reduce((a, c) => a + (c.xp | 0), 0);
      if (chXp) breakdown.push({ id: 'challenges', label: challenges.length === 1 ? 'Herausforderung' : `Herausforderungen (${challenges.length})`, xp: chXp });
      for (const [k, n] of Object.entries(s.counters)) data.counters[k] = (data.counters[k] || 0) + n;
    }
    const xpGained = Math.max(0, breakdown.reduce((a, b) => a + b.xp, 0));

    data.xp = Math.min(xpBefore + xpGained, xpForLevel(MAX_LEVEL) * 4);
    data.level = levelFor(data.xp);
    data.matches += 1;
    if (!training) {
      if (s.result === 'win') data.wins += 1; else if (s.result === 'draw') data.draws += 1; else data.losses += 1;
      const ms = data.modeStats[s.modeId] || (data.modeStats[s.modeId] = { matches: 0, wins: 0 });
      ms.matches += 1;
      if (s.result === 'win') ms.wins += 1;
    } else {
      const ms = data.modeStats.training || (data.modeStats.training = { matches: 0, wins: 0 });
      ms.matches += 1;
    }
    for (const k of ['kills', 'deaths', 'assists', 'headshots', 'shotsFired', 'shotsHit']) data[k] += s[k];
    data.playtime += s.duration;
    data.bestStreak = Math.max(data.bestStreak, s.bestStreak);
    data.longestKill = Math.max(data.longestKill, Math.round(s.longestKill * 10) / 10);
    for (const [id, w] of Object.entries(s.weaponStats)) {
      const t = data.weaponStats[id] || (data.weaponStats[id] = { kills: 0, shots: 0, hits: 0, headshots: 0 });
      t.kills += w.kills; t.shots += w.shots; t.hits += w.hits; t.headshots += w.headshots;
    }
    for (const [id, n] of Object.entries(s.medals)) data.medals[id] = (data.medals[id] || 0) + n;
    data.history.unshift({
      at: Date.now(), modeId: s.modeId, mapId: s.mapId, result: s.result, kills: s.kills, deaths: s.deaths,
      assists: s.assists, headshots: s.headshots, score: s.score, xp: xpGained, duration: Math.round(s.duration),
      bestStreak: s.bestStreak,
    });
    data.history.length = Math.min(data.history.length, HISTORY_MAX);
    save();
    notify();

    const rankBefore = rankFor(levelBefore);
    const rankAfter = rankFor(data.level);
    return {
      xpGained, xpBefore, xpAfter: data.xp, levelBefore, levelAfter: data.level,
      unlocked: unlockedBetween(levelBefore, data.level),
      breakdown, rankBefore, rankAfter,
      levelUp: data.level > levelBefore, rankUp: rankAfter.index > rankBefore.index,
      progressBefore: levelProgress(xpBefore), progressAfter: levelProgress(data.xp),
      challenges,
    };
  },

  /** modes-ui: Geheimnis gefunden (true = neu). */
  markSecret(id, name = '', map = '') {
    if (typeof id !== 'string' || !ID_RE.test(id)) return false;
    if (data.secrets[id]) return false;
    data.secrets[id] = { name: String(name || id).slice(0, 48), map: ID_RE.test(map || '') ? map : '', at: Date.now() };
    const t = data.challenges && data.challenges.totals;
    if (t) t.secrets = Object.keys(data.secrets).length;
    save();
    notify();
    return true;
  },

  /** modes-ui: Tarnung/Outfit ausrüsten. kind 'weapon' (key = Waffen-Id) | 'operator' (key = Klasse); value null = Standard. */
  equipCosmetic(kind, key, value) {
    const eq = data.cosmetics.equipped;
    const tab = kind === 'operator' ? eq.operator : kind === 'weapon' ? eq.weapon : null;
    if (!tab || !ID_RE.test(key || '')) return false;
    if (value == null || value === '') delete tab[key];
    else if (typeof value === 'string' && /^[a-z0-9_:-]{1,40}$/.test(value)) tab[key] = value;
    else return false;
    save();
    notify();
    return true;
  },

  levelFor,
  xpForLevel,
  levelProgress,
  rankFor,
  rankIcon,

  /** Ist eine Waffe/Ausrüstung auf dem aktuellen (oder angegebenen) Level verfügbar? */
  isUnlocked(id, level = data.level) {
    const need = unlockTable[id];
    return need === undefined ? true : need <= level;
  },
  /** Level, auf dem `id` freigeschaltet wird (undefined = unbekannt/immer). */
  unlockLevel(id) {
    return unlockTable[id];
  },
  /** Anzeigename einer Freischaltung (sobald weapons.data.js geladen ist). */
  unlockName(id) {
    return unlockNames[id] || id;
  },

  /** Abgeleitete Kennzahlen für Profil-/Statistikansichten. */
  stats() {
    const p = data;
    const prog = levelProgress(p.xp);
    return {
      level: p.level, rank: rankFor(p.level), progress: prog,
      kd: p.deaths ? p.kills / p.deaths : p.kills,
      accuracy: p.shotsFired ? p.shotsHit / p.shotsFired : 0,
      winRate: p.wins + p.losses + p.draws ? p.wins / (p.wins + p.losses + p.draws) : 0,
      headshotRate: p.kills ? p.headshots / p.kills : 0,
      avgScore: p.history.length ? p.history.reduce((a, h) => a + (h.score || 0), 0) / p.history.length : 0,
    };
  },

  setName(name) {
    settings.set('playerName', name);
    data.name = settings.get('playerName');
    save();
    notify();
  },

  reset() {
    data = blank();
    save();
    notify();
  },

  /** fn(profilKopie) bei jeder Änderung (auch aus anderen Tabs). Gibt Abmeldefunktion zurück. */
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

if (typeof window !== 'undefined' && storage) {
  window.addEventListener('storage', (e) => {
    if (e.storageArea !== storage || (e.key !== STORAGE_KEY && e.key !== null)) return;
    data = load();
    notify();
  });
}

export default profile;
