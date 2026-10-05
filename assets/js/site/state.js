// Seitenzustand (flüchtig) und der Website-Speicher 'nullpunkt:site' (robust, mit Rückfall im Arbeitsspeicher).

function store(initial) {
  let data = { ...initial };
  const fns = new Set();
  /**
   * Setzt alle Schlüssel und meldet erst danach (je geändertem Schlüssel einmal) – Zuhörer sehen nie einen
   * halben Zustand (z. B. neuer Modus mit den Mannschaftsstärken des alten).
   */
  const patch = (o) => {
    const changed = Object.keys(o || {}).filter((k) => data[k] !== o[k]);
    if (!changed.length) return;
    data = { ...data, ...o };
    for (const k of changed) {
      for (const fn of [...fns]) { try { fn(k, data[k], data); } catch (err) { console.error('[NULLPUNKT] state:', err); } }
    }
  };
  return {
    get(k) { return k ? data[k] : { ...data }; },
    set(k, v) { patch({ [k]: v }); },
    patch,
    onChange(fn) { fns.add(fn); return () => fns.delete(fn); },
  };
}

/** Flüchtiger Seitenzustand (Einsatz, Waffe, Distanz …). */
export const ui = store({
  mode: 'tdm', map: 'hafen', diff: 'regulaer', allies: 5, enemies: 6,
  weapon: 'ar_m17', distance: 20, zone: 'body', mapTab: 'hafen',
});

const KEY = 'nullpunkt:site';
// teams: zuletzt gewählte Mannschaftsstärken je Modus { [modeId]: { allies, enemies } } (Satzbau ↔ Spiel-Links)
const DEFAULTS = { v: 1, sound: false, bestGroupMm: null, lastSeenMatchAt: 0, lastSeenLevel: 1, teams: {} };

/** Nur ganzzahlige, nicht negative Stärken je Modus übernehmen (Grenzen prüft der Satzbau je Modus). */
function readTeams(t) {
  const out = {};
  if (!t || typeof t !== 'object' || Array.isArray(t)) return out;
  for (const [id, v] of Object.entries(t)) {
    if (!/^[a-z0-9_-]{1,24}$/.test(id) || !v || typeof v !== 'object') continue;
    const a = Number(v.allies);
    const e = Number(v.enemies);
    if (Number.isInteger(a) && a >= 0 && a <= 64 && Number.isInteger(e) && e >= 0 && e <= 64) out[id] = { allies: a, enemies: e };
  }
  return out;
}

function storage() {
  try {
    const s = window.localStorage;
    s.setItem('nullpunkt:__probe', '1');
    s.removeItem('nullpunkt:__probe');
    return s;
  } catch { return null; }
}
const ls = storage();

function read() {
  if (!ls) return { ...DEFAULTS, teams: {} };
  try {
    const raw = ls.getItem(KEY);
    if (!raw) return { ...DEFAULTS, teams: {} };
    const d = JSON.parse(raw);
    const out = { ...DEFAULTS };
    if (typeof d.sound === 'boolean') out.sound = d.sound;
    if (Number.isFinite(d.bestGroupMm) && d.bestGroupMm > 0) out.bestGroupMm = d.bestGroupMm;
    if (Number.isFinite(d.lastSeenMatchAt) && d.lastSeenMatchAt >= 0) out.lastSeenMatchAt = d.lastSeenMatchAt;
    if (Number.isFinite(d.lastSeenLevel) && d.lastSeenLevel >= 1) out.lastSeenLevel = d.lastSeenLevel;
    out.teams = readTeams(d.teams);
    out.initialised = d.initialised === true;
    return out;
  } catch { return { ...DEFAULTS, teams: {} }; }
}

const siteStore = store(read());
let silent = false;
siteStore.onChange(() => {
  if (!ls || silent) return;
  try { ls.setItem(KEY, JSON.stringify(siteStore.get())); } catch { /* voll oder gesperrt */ }
});

/** Website-Speicher. `persistent` = localStorage nutzbar. */
export const site = Object.assign(siteStore, {
  persistent: !!ls,
  /**
   * Setzt alles zurück und entfernt den Schlüssel, ohne ihn neu zu schreiben. Im Arbeitsspeicher gilt die
   * Seite danach als „bekannt“ (initialised), damit der nächste Einsatz wieder eine Fahne bekommt.
   */
  wipe() {
    silent = true;
    try {
      siteStore.patch({ ...DEFAULTS, teams: {}, initialised: true });
    } finally { silent = false; }
    if (ls) { try { ls.removeItem(KEY); } catch { /* egal */ } }
  },
});

if (ls) {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return;
    const next = read();
    const cur = siteStore.get();
    // Objektwerte (teams) nur bei echtem Unterschied übernehmen – sonst meldet jedes Ereignis eine „Änderung“
    for (const k of Object.keys(next)) if (typeof next[k] === 'object' && next[k] && JSON.stringify(next[k]) === JSON.stringify(cur[k])) delete next[k];
    siteStore.patch(next);
  });
}
