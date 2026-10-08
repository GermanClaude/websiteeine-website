// NULLPUNKT — Einstellungen (geteilt von Website und Spiel, §4 des Vertrags).
// localStorage-Schlüssel 'nullpunkt:settings'. Robust gegen fehlenden/gesperrten Speicher
// (dann nur im Arbeitsspeicher), validiert und begrenzt jeden Wert, synchronisiert sich
// zwischen Tabs über das 'storage'-Ereignis.

import { sanitizeBindings, sanitizeTouchLayout, DEFAULT_TOUCH_LAYOUT } from './bindings.data.js';

const STORAGE_KEY = 'nullpunkt:settings';

export const DEFAULTS = Object.freeze({
  playerName: 'Operator', sensitivity: 1.0, adsSensitivity: 0.85, touchSensitivity: 1.0,
  invertY: false, fov: 80, quality: 'auto' /* auto|low|medium|high|ultra */,
  masterVolume: 0.8, sfxVolume: 1.0, musicVolume: 0.5, uiVolume: 0.7,
  crosshairStyle: 'cross' /* cross|dot|circle */, crosshairColor: '#ffffff',
  showFps: false, aimAssist: true /* nur Touch */, autoFire: false /* Touch: „einfacher Modus“ */,
  difficulty: 'regulaer', lastMode: 'tdm', lastMap: 'hafen', lastLoadout: null, reducedMotion: false,
  // Steuerung & Komfort (Realismus-Plan F1/F4/F5, S1–S7; core-input)
  cameraMotion: 0.6, sensitivityY: 1.0, adsSensitivityMid: 0.85, adsSensitivityHigh: 0.85, zoomSensitivityCoef: '0',
  adsMode: 'hold', sprintMode: 'toggle', crouchMode: 'toggle', leanMode: 'hold', freeAim: 'off',
  padSensitivity: 1.0, padDeadzone: 0.13, padOuterDeadzone: 0.97, padCurve: 'classic', padVibration: true, padSwapSticks: false,
  aimAssistStrength: 1.0, gyroMode: 'off', gyroSensitivityX: 1.0, gyroSensitivityY: 1.0,
  touchOpacity: 1.0, touchButtonScale: 1.0, bindings: Object.freeze({}), touchLayout: DEFAULT_TOUCH_LAYOUT,
  // Waffengefühl (Realismus-Plan F2/F9; weapons-feel)
  weaponPose: 'auto', weaponSway: 1.0,
  // Waffe an Hindernissen: overlay = ruhig, über der Welt gezeichnet (wie die meisten Shooter) | raise | tuck | clip
  weaponObstruction: 'overlay',
  // Bild: Objektiv, Farbe, Belichtung, Hochskalierung (Realismus-Plan R2/R3/R4/R12; core-render)
  // Standard = Vorlage „Realistisch“ (dezentes Objektiv); kräftiges Fischauge nur über die Vorlage „Bodycam“
  lensStyle: 'bodycam', lensStrength: 0.15, grain: 0.2, lensArtifacts: 0.05, lensBorder: false,
  autoExposure: true, sharpness: 0.5, upscaler: 'fsr',
  // Klang (Realismus-Plan A1/A6/A8; audio)
  audioMix: 'auto', hearingProtection: false, audioRecordings: true,
  // HUD-Stil, erweiterte Grafik, Gyro-Kalibrierung, Controller-Symbole (Realismus-Plan S6–S9, §5.3; ui-controls)
  hudStyle: 'voll', bodycamStamp: false,
  gfxPost: 'auto', gfxShadows: 'auto', gfxAA: 'auto', gfxAO: 'auto', gfxBloom: 'auto', gfxEffects: 'auto', gfxPixelRatio: 'auto',
  renderScale: 'auto', fpsLimit: '0',
  gyroBiasX: 0, gyroBiasY: 0, gyroBiasZ: 0, padIcons: 'auto',
  // Kernmechanik (core-mechanics): Spielstil, Klassen, stufenlose Zielhilfe und Auto-Feuer
  gameStyle: 'arcade', realisticCrosshair: false, lastClass: 'sturm', classLoadouts: Object.freeze({}),
  aimAssistLevel: 0.5, aimAssistDevices: 'touch_pad', autoFireLevel: 0.6, autoFireDevices: 'touch',
  // Vollbild (engine/fullscreen.js): auto = bei „Einsatz starten“, „Fortsetzen“ und (Touch) Tippen auf die Steuerung im Match | off = nur Knopf/Taste
  fullscreen: 'auto',
  // Lobby: Wetter/Tageszeit (atmosphere-weather): 'standard' | 'zufall' | Wetter-/Zeit-id
  lastWeather: 'standard', lastTime: 'standard',
  // Lernende Bots (ai-adapt): Gegner stellen sich auf den Spielstil ein (Stärke nach Schwierigkeit)
  adaptiveBots: true,
});

const HOLD_TOGGLE = Object.freeze({ options: ['hold', 'toggle'], labels: { hold: 'Halten', toggle: 'Umschalten' } });

/**
 * Beschreibung jedes Werts für Einstellungsoberflächen (Website + Spielmenü):
 * type, Grenzen, Schrittweite, deutsche Beschriftung, Optionen mit Beschriftungen.
 */
export const SETTINGS_SCHEMA = Object.freeze({
  playerName: { type: 'string', maxLength: 16, label: 'Spielername', group: 'profil' },
  sensitivity: { type: 'number', min: 0.1, max: 5, step: 0.05, label: 'Mausempfindlichkeit', group: 'steuerung' },
  adsSensitivity: { type: 'number', min: 0.2, max: 2, step: 0.05, label: 'Empfindlichkeit im Anschlag (1×)', group: 'steuerung' },
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
  aimAssist: { type: 'boolean', label: 'Zielhilfe', group: 'steuerung' },
  autoFire: { type: 'boolean', label: 'Automatisch feuern', group: 'steuerung' },
  difficulty: {
    type: 'enum', label: 'Bot-Schwierigkeit', group: 'spiel',
    options: ['rekrut', 'regulaer', 'veteran', 'elite'],
    labels: { rekrut: 'Rekrut', regulaer: 'Regulär', veteran: 'Veteran', elite: 'Elite' },
  },
  lastMode: { type: 'id', label: 'Letzter Modus', group: 'intern' },
  lastMap: { type: 'id', label: 'Letzte Karte', group: 'intern' },
  lastLoadout: { type: 'loadout', label: 'Letzte Ausrüstung', group: 'intern' },
  reducedMotion: { type: 'boolean', label: 'Bewegung reduzieren', group: 'grafik' },
  // Steuerung & Komfort (core-input; Bedeutung im Changelog „core-input“)
  cameraMotion: { type: 'number', min: 0, max: 1, step: 0.05, label: 'Kamerabewegung (Bodycam)', group: 'grafik' },
  sensitivityY: { type: 'number', min: 0.3, max: 2, step: 0.05, label: 'Vertikale Empfindlichkeit (Faktor)', group: 'steuerung' },
  adsSensitivityMid: { type: 'number', min: 0.2, max: 2, step: 0.05, label: 'Empfindlichkeit im Anschlag (2–4×)', group: 'steuerung' },
  adsSensitivityHigh: { type: 'number', min: 0.2, max: 2, step: 0.05, label: 'Empfindlichkeit im Anschlag (ab 6×)', group: 'steuerung' },
  zoomSensitivityCoef: {
    type: 'enum', label: 'Zoom-Umrechnung (Monitorabstand)', group: 'steuerung',
    options: ['0', '0.75', '1'], labels: { 0: '0 % · Mitte', 0.75: '75 %', 1: '100 % · Rand' },
  },
  adsMode: { type: 'enum', label: 'Zielen', group: 'steuerung', ...HOLD_TOGGLE },
  sprintMode: { type: 'enum', label: 'Sprinten', group: 'steuerung', ...HOLD_TOGGLE },
  crouchMode: { type: 'enum', label: 'Ducken', group: 'steuerung', ...HOLD_TOGGLE },
  leanMode: { type: 'enum', label: 'Lehnen', group: 'steuerung', ...HOLD_TOGGLE },
  freeAim: {
    type: 'enum', label: 'Freies Zielen (Maus & Controller)', group: 'steuerung',
    options: ['off', 'light', 'strong'], labels: { off: 'Aus', light: 'Leicht (2°)', strong: 'Stark (5°)' },
  },
  padSensitivity: { type: 'number', min: 0.2, max: 3, step: 0.05, label: 'Controller-Empfindlichkeit', group: 'steuerung' },
  padDeadzone: { type: 'number', min: 0, max: 0.35, step: 0.01, label: 'Innere Totzone (Controller)', group: 'steuerung' },
  padOuterDeadzone: { type: 'number', min: 0.7, max: 1, step: 0.01, label: 'Äußere Totzone (Controller)', group: 'steuerung' },
  padCurve: {
    type: 'enum', label: 'Reaktionskurve (Controller)', group: 'steuerung',
    options: ['linear', 'classic', 'dynamic'], labels: { linear: 'Linear', classic: 'Klassisch', dynamic: 'Dynamisch' },
  },
  padVibration: { type: 'boolean', label: 'Vibration (Controller)', group: 'steuerung' },
  padSwapSticks: { type: 'boolean', label: 'Sticks tauschen (Linkshänder)', group: 'steuerung' },
  // Älterer Controller-Faktor (wirkt weiter multiplikativ); die sichtbare Stärke ist jetzt aimAssistLevel
  aimAssistStrength: { type: 'number', min: 0.2, max: 1.5, step: 0.05, label: 'Zielhilfe-Faktor (Controller)', group: 'intern' },
  gyroMode: {
    type: 'enum', label: 'Gyro-Zielen (Handy)', group: 'steuerung',
    options: ['off', 'ads', 'always'], labels: { off: 'Aus', ads: 'Beim Zielen', always: 'Immer' },
  },
  gyroSensitivityX: { type: 'number', min: 0.1, max: 4, step: 0.05, label: 'Gyro-Empfindlichkeit waagerecht', group: 'steuerung' },
  gyroSensitivityY: { type: 'number', min: 0.1, max: 4, step: 0.05, label: 'Gyro-Empfindlichkeit senkrecht', group: 'steuerung' },
  touchOpacity: { type: 'number', min: 0.2, max: 1, step: 0.05, label: 'Deckkraft der Touch-Knöpfe', group: 'steuerung' },
  touchButtonScale: { type: 'number', min: 0.8, max: 1.3, step: 0.05, label: 'Größe der Touch-Knöpfe', group: 'steuerung' },
  bindings: { type: 'bindings', label: 'Tastenbelegung', group: 'belegung' },
  touchLayout: { type: 'touchLayout', label: 'Touch-Layout', group: 'belegung' },
  // Waffengefühl (weapons-feel; Bedeutung im Changelog „weapons-feel“)
  weaponPose: {
    type: 'enum', label: 'Waffenhaltung', group: 'grafik',
    options: ['auto', 'standard', 'bodycam'], labels: { auto: 'Automatisch', standard: 'Standard (Hüfte)', bodycam: 'Körperkamera (tief, mittig)' },
  },
  weaponSway: { type: 'number', min: 0, max: 1, step: 0.05, label: 'Waffenträgheit und -schwanken', group: 'grafik' },
  weaponObstruction: {
    type: 'enum', label: 'Waffe an Wänden und Hindernissen', group: 'grafik',
    options: ['overlay', 'raise', 'tuck', 'clip'],
    labels: { overlay: 'Ruhig (Standard)', raise: 'Hochnehmen', tuck: 'An den Körper ziehen', clip: 'Keine Anpassung' },
  },
  // Bild (core-render; Bedeutung im Changelog „core-render“)
  lensStyle: {
    type: 'enum', label: 'Bildstil', group: 'grafik',
    options: ['bodycam', 'klassisch', 'aus'], labels: { bodycam: 'Bodycam', klassisch: 'Klassisch', aus: 'Aus (klares Bild)' },
  },
  lensStrength: { type: 'number', min: 0, max: 1, step: 0.05, label: 'Objektivverzeichnung (Fischauge)', group: 'grafik' },
  grain: { type: 'number', min: 0, max: 1, step: 0.05, label: 'Bildrauschen', group: 'grafik' },
  lensArtifacts: { type: 'number', min: 0, max: 1, step: 0.05, label: 'Kompressionsspuren', group: 'grafik' },
  lensBorder: { type: 'boolean', label: 'Kameragehäuse (schwarzer Rand)', group: 'grafik' },
  autoExposure: { type: 'boolean', label: 'Automatische Belichtung', group: 'grafik' },
  sharpness: { type: 'number', min: 0, max: 1, step: 0.05, label: 'Bildschärfe', group: 'grafik' },
  upscaler: {
    type: 'enum', label: 'Hochskalierung', group: 'grafik',
    options: ['fsr', 'bilinear'], labels: { fsr: 'FSR 1.0', bilinear: 'Bilinear' },
  },
  // Klang (audio; Bedeutung im Changelog „audio-hybrid“)
  audioMix: {
    type: 'enum', label: 'Wiedergabe über', group: 'audio',
    options: ['auto', 'kopfhoerer', 'lautsprecher', 'handy'], labels: { auto: 'Automatisch', kopfhoerer: 'Kopfhörer', lautsprecher: 'Lautsprecher', handy: 'Handy' },
  },
  hearingProtection: { type: 'boolean', label: 'Gehörschutz (mildert Knalltrauma und Ohrenklingeln)', group: 'audio' },
  audioRecordings: { type: 'boolean', label: 'Echte Tonaufnahmen (aus: nur Klangsynthese, kein Download)', group: 'audio' },
  // HUD, erweiterte Grafik (Gruppe 'erweitert': 'auto' = Wert der Qualitätsstufe, siehe shared/graphics.data.js),
  // Gyro-Kalibrierung (°/s, wird von rotationRate abgezogen), Controller-Symbole (ui-controls)
  hudStyle: {
    type: 'enum', label: 'HUD-Stil', group: 'hud',
    options: ['voll', 'reduziert', 'aus'], labels: { voll: 'Voll', reduziert: 'Reduziert', aus: 'Realismus' },
  },
  bodycamStamp: { type: 'boolean', label: 'Bodycam-Einblendung (Uhrzeit, Geräte-ID)', group: 'hud' },
  gfxPost: {
    type: 'enum', label: 'Nachbearbeitung', group: 'erweitert',
    options: ['auto', 'einfach', 'voll'], labels: { auto: 'Automatisch', einfach: 'Einfach (1 Pass)', voll: 'Voll' },
  },
  gfxShadows: {
    type: 'enum', label: 'Schatten', group: 'erweitert',
    options: ['auto', 'aus', 'niedrig', 'mittel', 'hoch', 'ultra'],
    labels: { auto: 'Automatisch', aus: 'Aus', niedrig: 'Niedrig', mittel: 'Mittel', hoch: 'Hoch', ultra: 'Ultra' },
  },
  gfxAA: {
    type: 'enum', label: 'Kantenglättung', group: 'erweitert',
    options: ['auto', 'aus', 'fxaa', 'smaa'], labels: { auto: 'Automatisch', aus: 'Aus', fxaa: 'FXAA', smaa: 'SMAA' },
  },
  gfxAO: {
    type: 'enum', label: 'Umgebungsverdeckung (GTAO)', group: 'erweitert',
    options: ['auto', 'aus', 'an'], labels: { auto: 'Automatisch', aus: 'Aus', an: 'An' },
  },
  gfxBloom: {
    type: 'enum', label: 'Leuchten (Bloom)', group: 'erweitert',
    options: ['auto', 'aus', 'an'], labels: { auto: 'Automatisch', aus: 'Aus', an: 'An' },
  },
  gfxEffects: {
    type: 'enum', label: 'Effekte (Partikel, Einschusslöcher)', group: 'erweitert',
    options: ['auto', 'niedrig', 'mittel', 'hoch', 'ultra'],
    labels: { auto: 'Automatisch', niedrig: 'Niedrig', mittel: 'Mittel', hoch: 'Hoch', ultra: 'Ultra' },
  },
  gfxPixelRatio: {
    type: 'enum', label: 'Pixeldichte (höchstens)', group: 'erweitert',
    options: ['auto', '1', '1.25', '1.5', '2', '3'], labels: { auto: 'Automatisch', 1: '1×', 1.25: '1,25×', 1.5: '1,5×', 2: '2×', 3: '3×' },
  },
  renderScale: {
    type: 'enum', label: 'Auflösungsskala', group: 'erweitert',
    options: ['auto', '100', '85', '75', '67', '50'], labels: { auto: 'Dynamisch', 100: '100 %', 85: '85 %', 75: '75 %', 67: '67 %', 50: '50 %' },
  },
  fpsLimit: {
    type: 'enum', label: 'Bildratenbegrenzung', group: 'erweitert',
    options: ['0', '30', '60', '120'], labels: { 0: 'Frei', 30: '30', 60: '60', 120: '120' },
  },
  gyroBiasX: { type: 'number', min: -5, max: 5, step: 0.001, label: 'Gyro-Nullpunkt X (°/s)', group: 'intern' },
  gyroBiasY: { type: 'number', min: -5, max: 5, step: 0.001, label: 'Gyro-Nullpunkt Y (°/s)', group: 'intern' },
  gyroBiasZ: { type: 'number', min: -5, max: 5, step: 0.001, label: 'Gyro-Nullpunkt Z (°/s)', group: 'intern' },
  padIcons: {
    type: 'enum', label: 'Controller-Symbole', group: 'belegung',
    options: ['auto', 'xbox', 'ps'], labels: { auto: 'Automatisch', xbox: 'Xbox', ps: 'PlayStation' },
  },
  gameStyle: {
    type: 'enum', label: 'Spielstil', group: 'spiel',
    options: ['arcade', 'realistisch'], labels: { arcade: 'Arcade', realistisch: 'Realistisch' },
  },
  realisticCrosshair: { type: 'boolean', label: 'Fadenkreuz im Spielstil „Realistisch“', group: 'hud' },
  lastClass: { type: 'id', label: 'Letzte Klasse', group: 'intern' },
  lastWeather: { type: 'id', label: 'Letztes Wetter', group: 'intern' },
  lastTime: { type: 'id', label: 'Letzte Tageszeit', group: 'intern' },
  classLoadouts: { type: 'classLoadouts', label: 'Ausrüstung je Klasse', group: 'intern' },
  aimAssistLevel: {
    type: 'number', min: 0, max: 1, step: 0.05, label: 'Stärke der Zielhilfe (Bremsen → Ziehen → Einrasten)', group: 'steuerung',
  },
  aimAssistDevices: {
    type: 'enum', label: 'Zielhilfe für', group: 'steuerung',
    options: ['touch', 'touch_pad', 'alle'], labels: { touch: 'Nur Touch', touch_pad: 'Touch & Controller', alle: 'Alle Geräte (auch Maus)' },
  },
  autoFireLevel: {
    type: 'number', min: 0, max: 1, step: 0.05, label: 'Stärke des Auto-Feuers (Verzögerung, Reichweite, Toleranz)', group: 'steuerung',
  },
  autoFireDevices: {
    type: 'enum', label: 'Auto-Feuer für', group: 'steuerung',
    options: ['touch', 'alle'], labels: { touch: 'Nur Touch', alle: 'Alle Geräte (auch Maus & Controller)' },
  },
  adaptiveBots: { type: 'boolean', label: 'Lernende Bots', group: 'spiel' },
  fullscreen: {
    type: 'enum', label: 'Vollbild', group: 'spiel',
    options: ['auto', 'off'], labels: { auto: 'Automatisch', off: 'Nur per Knopf/Taste' },
  },
});

/**
 * Obergrenzen der Hilfen für späteres Online-Spiel (G.match.assistCap): offline keine, Koop moderat,
 * Spieler gegen Spieler nur leichte Zielhilfe und kein Auto-Feuer. Geräte-Stufen: touch < touch_pad < alle.
 */
export const ASSIST_CAPS = Object.freeze({
  coop: Object.freeze({ aimAssistLevel: 0.6, autoFireLevel: 0.5, aimAssistDevices: 'touch_pad', autoFireDevices: 'touch' }),
  pvp: Object.freeze({ aimAssistLevel: 0.3, autoFireLevel: 0, aimAssistDevices: 'touch_pad', autoFireDevices: 'touch' }),
});
const DEVICE_RANK = { touch: 0, touch_pad: 1, alle: 2 };

/**
 * Wirksame Hilfe-Stufen aus den Einstellungen, gedeckelt durch `cap` (ASSIST_CAPS-Eintrag oder null).
 * get = (key) → Wert (z. B. settings.get). → { aim, aimDevices, fire, fireDevices } (aim/fire 0…1, 0 = aus)
 */
export function assistLevels(get, cap = null) {
  const num = (k, d) => { const v = Number(get(k)); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d; };
  const dev = (k, d, c) => { const v = DEVICE_RANK[get(k)] != null ? get(k) : d; return c && DEVICE_RANK[c] < DEVICE_RANK[v] ? c : v; };
  let aim = get('aimAssist') === false ? 0 : num('aimAssistLevel', 0.5);
  let fire = get('autoFire') ? num('autoFireLevel', 0.6) : 0;
  if (cap) { aim = Math.min(aim, cap.aimAssistLevel ?? 1); fire = Math.min(fire, cap.autoFireLevel ?? 1); }
  return {
    aim, aimDevices: dev('aimAssistDevices', 'touch_pad', cap && cap.aimAssistDevices),
    fire, fireDevices: dev('autoFireDevices', 'touch', cap && cap.autoFireDevices),
  };
}

/** Gilt eine Hilfe mit Geräte-Stufe `devices` für das Eingabegerät `device` ('touch'|'gamepad'|'keyboard'|'mouse')? */
export function assistAppliesTo(devices, device) {
  if (device === 'touch') return true;
  if (device === 'gamepad') return devices === 'touch_pad' || devices === 'alle';
  return devices === 'alle';
}

/* ------------------------------------------------------------ Validierung */

const ID_RE = /^[a-z0-9_-]{1,32}$/;
// Ausrüstungsfelder (additiv: cls/armor/helmet/tactical für Klassen und Panzerung, core-mechanics)
const LOADOUT_FIELDS = ['id', 'primary', 'secondary', 'lethal', 'tactical', 'cls', 'armor', 'helmet'];
function validateLoadout(value) {
  if (!value || typeof value !== 'object') return undefined;
  const out = {};
  for (const f of LOADOUT_FIELDS) {
    if (value[f] == null) continue;
    if (typeof value[f] !== 'string' || !ID_RE.test(value[f])) return undefined;
    out[f] = value[f];
  }
  return out.primary || out.secondary ? out : undefined;
}
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
    case 'loadout':
      return value === null ? null : validateLoadout(value);
    case 'classLoadouts': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
      const out = {};
      for (const [k, v] of Object.entries(value).slice(0, 16)) {
        if (!ID_RE.test(k)) continue;
        const lo = validateLoadout(v);
        if (lo) out[k] = lo;
      }
      return out;
    }
    case 'bindings':
      return sanitizeBindings(value);
    case 'touchLayout':
      return sanitizeTouchLayout(value);
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

/** Tiefe Kopie einfacher Daten (Objekt-Einstellungen wie bindings/touchLayout dürfen nicht geteilt werden). */
function clone(v) {
  return JSON.parse(JSON.stringify(v));
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
    return v && typeof v === 'object' ? clone(v) : v;
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
    for (const k of Object.keys(out)) if (out[k] && typeof out[k] === 'object') out[k] = clone(out[k]);
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
