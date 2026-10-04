// NULLPUNKT — Einstellungen (geteilt von Website und Spiel, §4 des Vertrags).
// localStorage-Schlüssel 'nullpunkt:settings'. Robust gegen fehlenden/gesperrten Speicher
// (dann nur im Arbeitsspeicher), validiert und begrenzt jeden Wert, synchronisiert sich
// zwischen Tabs über das 'storage'-Ereignis.

const STORAGE_KEY = 'nullpunkt:settings';

export const DEFAULTS = Object.freeze({
  playerName: 'Operator', sensitivity: 1.0, adsSensitivity: 0.85, touchSensitivity: 1.0,
  invertY: false, fov: 80, quality: 'auto' /* auto|low|medium|high|ultra */,
  masterVolume: 0.8, sfxVolume: 1.0, musicVolume: 0.5, uiVolume: 0.7,
  crosshairStyle: 'cross' /* cross|dot|circle */, crosshairColor: '#ffffff',
  showFps: false, aimAssist: true /* nur Touch */, autoFire: false /* Touch: „einfacher Modus“ */,
  difficulty: 'regulaer', lastMode: 'tdm', lastMap: 'hafen', lastLoadout: null, reducedMotion: false,
});

/**
 * Beschreibung jedes Werts für Einstellungsoberflächen (Website + Spielmenü):
 * type, Grenzen, Schrittweite, deutsche Beschriftung, Optionen mit Beschriftungen.
 */
export const SETTINGS_SCHEMA = Object.freeze({
  playerName: { type: 'string', maxLength: 16, label: 'Spielername', group: 'profil' },
  sensitivity: { type: 'number', min: 0.1, max: 5, step: 0.05, label: 'Mausempfindlichkeit', group: 'steuerung' },
  adsSensitivity: { type: 'number', min: 0.2, max: 2, step: 0.05, label: 'Empfindlichkeit im Anschlag', group: 'steuerung' },
  touchSensitivity: { type: 'number', min: 0.2, max: 3, step: 0.05, label: 'Touch-Empfindlichkeit', group: 'steuerung' },
  invertY: { type: 'boolean', label: 'Y-Achse umkehren', group: 'steuerung' },
  fov: { type: 'number', min: 60, max: 110, step: 1, integer: true, unit: '°', label: 'Sichtfeld', group: 'grafik' },
  quality: {
    type: 'enum', label: 'Grafikqualität', group: 'grafik',
    options: ['auto', 'low', 'medium', 'high', 'ultra'],
    labels: { auto: 'Automatisch', low: 'Niedrig', medium: 'Mittel', high: 'Hoch', ultra: 'Ultra' },
  },
  masterVolume: { type: 'number', min: 0, max: 1, step: 0.05, label: 'Gesamtlautstärke', group: 'audio' },
  sfxVolume: { type: 'number', min: 0, max: 1, step: 0.05, label: 'Effekte', group: 'audio' },
  musicVolume: { type: 'number', min: 0, max: 1, step: 0.05, label: 'Musik & Atmosphäre', group: 'audio' },
  uiVolume: { type: 'number', min: 0, max: 1, step: 0.05, label: 'Oberfläche', group: 'audio' },
  crosshairStyle: {
    type: 'enum', label: 'Fadenkreuz', group: 'hud',
    options: ['cross', 'dot', 'circle'], labels: { cross: 'Kreuz', dot: 'Punkt', circle: 'Kreis' },
  },
  crosshairColor: { type: 'color', label: 'Fadenkreuzfarbe', group: 'hud' },
  showFps: { type: 'boolean', label: 'FPS anzeigen', group: 'hud' },
  aimAssist: { type: 'boolean', label: 'Zielhilfe (Touch & Controller)', group: 'steuerung' },
  autoFire: { type: 'boolean', label: 'Automatisch feuern (Touch)', group: 'steuerung' },
  difficulty: {
    type: 'enum', label: 'Bot-Schwierigkeit', group: 'spiel',
    options: ['rekrut', 'regulaer', 'veteran', 'elite'],
    labels: { rekrut: 'Rekrut', regulaer: 'Regulär', veteran: 'Veteran', elite: 'Elite' },
  },
  lastMode: { type: 'id', label: 'Letzter Modus', group: 'intern' },
  lastMap: { type: 'id', label: 'Letzte Karte', group: 'intern' },
  lastLoadout: { type: 'loadout', label: 'Letzte Ausrüstung', group: 'intern' },
  reducedMotion: { type: 'boolean', label: 'Bewegung reduzieren', group: 'grafik' },
});

/* ------------------------------------------------------------ Validierung */

const ID_RE = /^[a-z0-9_-]{1,32}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

function sanitizeName(v) {
  if (typeof v !== 'string') return undefined;
  // Steuerzeichen entfernen, Leerraum zusammenfassen, Länge begrenzen.
  const clean = v.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return clean || DEFAULTS.playerName;
}

/** Gibt den bereinigten Wert zurück oder `undefined`, wenn er unbrauchbar ist. */
function validate(key, value) {
  const s = SETTINGS_SCHEMA[key];
  if (!s) return undefined;
  switch (s.type) {
    case 'number': {
      const n = typeof value === 'string' ? parseFloat(value.replace(',', '.')) : Number(value);
      if (!Number.isFinite(n)) return undefined;
      let c = Math.min(s.max, Math.max(s.min, n));
      if (s.integer) c = Math.round(c);
      return Math.round(c * 1000) / 1000;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 1 || value === '1') return true;
      if (value === 'false' || value === 0 || value === '0') return false;
      return undefined;
    case 'enum':
      return s.options.includes(value) ? value : undefined;
    case 'color':
      return typeof value === 'string' && COLOR_RE.test(value) ? value.toLowerCase() : undefined;
    case 'string':
      return key === 'playerName' ? sanitizeName(value) : (typeof value === 'string' ? value.slice(0, s.maxLength || 64) : undefined);
    case 'id':
      return typeof value === 'string' && ID_RE.test(value) ? value : undefined;
    case 'loadout': {
      if (value === null) return null;
      if (!value || typeof value !== 'object') return undefined;
      const out = {};
      for (const f of ['id', 'primary', 'secondary', 'lethal']) {
        if (value[f] == null) continue;
        if (typeof value[f] !== 'string' || !ID_RE.test(value[f])) return undefined;
        out[f] = value[f];
      }
      return out.primary || out.secondary ? out : undefined;
    }
    default:
      return undefined;
  }
}

/* --------------------------------------------------------------- Speicher */

function getStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const s = window.localStorage;
    const probe = 'nullpunkt:__probe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

const storage = getStorage();

function readStored() {
  const out = { ...DEFAULTS };
  if (!storage) return out;
  let raw = null;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return out; }
  if (!raw) return out;
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') {
      for (const key of Object.keys(DEFAULTS)) {
        if (!(key in data)) continue;
        const v = validate(key, data[key]);
        if (v !== undefined) out[key] = v;
      }
    }
  } catch { /* beschädigte Daten → Standardwerte */ }
  return out;
}

let values = readStored();
const listeners = new Set();

function persist() {
  if (!storage) return;
  try { storage.setItem(STORAGE_KEY, JSON.stringify(values)); } catch { /* Kontingent voll / gesperrt */ }
}

function notify(key, value) {
  for (const fn of [...listeners]) {
    try { fn(key, value, values); } catch (err) { console.error('[NULLPUNKT] settings.onChange-Listener:', err); }
  }
}

function sameValue(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

/* ------------------------------------------------------------------- API */

export const settings = {
  defaults: DEFAULTS,
  schema: SETTINGS_SCHEMA,
  /** true, wenn localStorage nutzbar ist (sonst nur Sitzungsspeicher). */
  persistent: !!storage,

  get(key) {
    const v = values[key];
    return v && typeof v === 'object' ? { ...v } : v;
  },

  /** Setzt einen Wert (validiert/begrenzt). Gibt den gespeicherten Wert zurück (oder den alten bei ungültiger Eingabe). */
  set(key, value) {
    if (!(key in DEFAULTS)) return undefined;
    const v = validate(key, value);
    if (v === undefined) return values[key];
    if (sameValue(values[key], v)) return v;
    values = { ...values, [key]: v };
    persist();
    notify(key, v);
    return v;
  },

  /** Mehrere Werte auf einmal; meldet jede tatsächliche Änderung einzeln. */
  patch(obj) {
    if (!obj || typeof obj !== 'object') return this.all();
    const changed = [];
    const next = { ...values };
    for (const key of Object.keys(obj)) {
      if (!(key in DEFAULTS)) continue;
      const v = validate(key, obj[key]);
      if (v === undefined || sameValue(next[key], v)) continue;
      next[key] = v;
      changed.push(key);
    }
    if (changed.length) {
      values = next;
      persist();
      for (const k of changed) notify(k, values[k]);
    }
    return this.all();
  },

  all() {
    const out = { ...values };
    if (out.lastLoadout) out.lastLoadout = { ...out.lastLoadout };
    return out;
  },

  reset() {
    const prev = values;
    values = { ...DEFAULTS };
    persist();
    for (const k of Object.keys(DEFAULTS)) if (!sameValue(prev[k], values[k])) notify(k, values[k]);
  },

  /** fn(key, value, alleWerte) bei jeder Änderung (auch aus anderen Tabs). Gibt Abmeldefunktion zurück. */
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Prüft einen Wert, ohne ihn zu setzen (für Formulare). `undefined` = ungültig. */
  validate(key, value) {
    return validate(key, value);
  },
};

// Tab-übergreifende Synchronisation.
if (typeof window !== 'undefined' && storage) {
  window.addEventListener('storage', (e) => {
    if (e.storageArea !== storage || (e.key !== STORAGE_KEY && e.key !== null)) return;
    const prev = values;
    values = readStored();
    for (const k of Object.keys(DEFAULTS)) if (!sameValue(prev[k], values[k])) notify(k, values[k]);
  });
}

export default settings;
