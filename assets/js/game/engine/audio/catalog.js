// Klangkatalog: Name → Rezept + Mischparameter.
// bus: sfx (Welt, wird gedämpft) | amb | fb (Spiel-Feedback, ungedämpft) | ui | music
// ref/roll: Panner-Abstandsmodell · maxDist: Kappung · group/cap: Stimmenbegrenzung · prio: 0 Atmo … 3 Spieler
// env: Hall-/Echo-Anteil · tier: Vorrendern (0–2 Match-Bank, 3 Karten-Atmo bei Bedarf, 4 nur bei Bedarf)
// rate/rateLow: feste Abtastrate (Hz) volle/niedrige Qualität – nach gemessener Bandbreite gewählt
//   (Anteil oberhalb 0,45 · Rate ≤ ca. −40 dB; tools/out/fix-audio/bandwidth*.mjs) → spart Speicher und Rechenzeit
// variantsLow: weniger Varianten bei niedriger Qualität · cheap: winzig (darf außerhalb des Spiels synchron rendern)
// alt: Ersatzklänge, falls im Spiel noch nicht gerendert (nie synchron nachrendern) · transient: nach Gebrauch freigeben
import { GUN_PROFILES, gunNear, gunFar, HANDLING, explosionNear, explosionFar, bulletWhiz, bulletCrack } from './sfx-weapons.js';
import { SURFACES, footstep, gearRattle, jump, land, slide, impact, hitFlesh, hitHelmet, pain, death, heartbeat, breathIn, breathOut } from './sfx-foley.js';
import { UI_RECIPES, FEEDBACK } from './sfx-ui.js';
import { AMB_EVENTS, AMBIENCES, ambienceBed, BED_RATE, EVENT_RATE } from './ambience.js';
import { STEMS, STEM_SR, STEM_IDS } from './music.js';

export const RATE_FULL = 48000;
export const RATE_LOW = 32000;
const BASE = {
  variants: 1, variantsLow: 0, bus: 'sfx', gain: 1, ref: 3, roll: 1.2, maxDist: 80, group: null, cap: 8, prio: 1, env: 0.25,
  pitchJit: 0.03, gainJit: 0.08, rate: RATE_FULL, rateLow: RATE_LOW, tier: 2, cheap: false, alt: null, transient: false,
};
export const CATALOG = Object.create(null);
const def = (name, render, o = {}) => (CATALOG[name] = { ...BASE, name, render, ...o });

// Schüsse: nah stereo (Spieler 2D; volle Bandbreite für den Mündungsknall), fern mono und schmalbandig
const GUN_ALT = { ar: ['ar_heavy', 'smg'], ar_heavy: ['ar', 'lmg'], smg: ['pistol', 'ar'], lmg: ['ar_heavy', 'ar'], sniper: ['ar_heavy', 'lmg'], shotgun: ['ar_heavy', 'pistol_heavy'], pistol: ['smg', 'pistol_heavy'], pistol_heavy: ['pistol', 'ar_heavy'] };
for (const [id, P] of Object.entries(GUN_PROFILES)) {
  def(`gun_${id}`, gunNear(P), { variants: 4, variantsLow: 3, gain: P.gain, ref: 7, roll: 1, maxDist: 600, group: 'gun', cap: 16, prio: 2, env: 0.55, pitchJit: 0.035, gainJit: 0.1, tier: 1, alt: GUN_ALT[id].map(p => `gun_${p}`) });
  def(`gunfar_${id}`, gunFar(P), { variants: 2, gain: P.gain, ref: 7, roll: 1, maxDist: 900, group: 'gun', cap: 16, prio: 1, env: 0.7, pitchJit: 0.04, tier: 1, rate: 22050, rateLow: 16000, alt: GUN_ALT[id].map(p => `gunfar_${p}`) });
}

// Handling & Nachladen
const H = (name, o) => def(name, HANDLING[name], { ref: 2, roll: 1.4, maxDist: 24, group: 'handling', cap: 8, prio: 1, env: 0.12, tier: 1, ...o });
H('dryfire', { gain: 0.6 });
H('reload_mag_out', { variants: 2, gain: 0.7 });
H('reload_mag_in', { variants: 2, gain: 0.75 });
H('reload_bolt', { variants: 2, gain: 0.75, alt: ['bolt'] });
H('reload_shell', { variants: 3, gain: 0.65 });
H('bolt', { variants: 2, gain: 0.8, alt: ['reload_bolt'] });
H('pump', { variants: 2, gain: 0.85, alt: ['reload_bolt'] });
H('equip', { variants: 2, gain: 0.55 });
H('ads_in', { variants: 2, gain: 0.38, tier: 2 });
H('ads_out', { variants: 2, gain: 0.32, tier: 2 });
H('melee_swing', { variants: 2, gain: 0.6, maxDist: 20 });
H('melee_hit', { variants: 3, gain: 0.9, maxDist: 30 });
H('grenade_pin', { variants: 2, gain: 0.7, maxDist: 30 });
H('grenade_throw', { gain: 0.5, maxDist: 20 });
H('grenade_bounce', { variants: 3, gain: 0.7, ref: 3, maxDist: 45, group: 'bounce', cap: 4, env: 0.25, rate: 16000 });
H('grenade_stick', { variants: 2, gain: 0.8, ref: 3, maxDist: 35, group: 'bounce', cap: 4, prio: 2, env: 0.2, tier: 2 });
H('low_ammo', { gain: 0.3, tier: 2 });

// Explosionen
def('explosion', explosionNear, { variants: 2, ref: 14, roll: 1, maxDist: 800, group: 'boom', cap: 4, prio: 2, env: 0.7, pitchJit: 0.05, tier: 1, alt: ['explosion_far'] });
def('explosion_far', explosionFar, { variants: 2, ref: 14, roll: 1, maxDist: 1200, group: 'boom', cap: 4, prio: 2, env: 0.8, pitchJit: 0.05, tier: 1, rate: 16000, alt: ['explosion'] });

// Geschosse
def('bullet_whiz', bulletWhiz, { variants: 4, gain: 0.75, ref: 1.5, roll: 1, maxDist: 10, group: 'whiz', cap: 3, prio: 2, env: 0.08, pitchJit: 0.08, tier: 1, alt: ['bullet_crack'] });
def('bullet_crack', bulletCrack, { variants: 3, gain: 0.8, ref: 1.5, roll: 1, maxDist: 10, group: 'whiz', cap: 3, prio: 2, env: 0.15, pitchJit: 0.06, tier: 1, alt: ['bullet_whiz'] });

// Schritte & Bewegung
const STEP_GAIN = { concrete: 0.85, metal: 1, wood: 0.9, dirt: 0.75, sand: 0.7, grass: 0.6, glass: 0.85, water: 0.9, tile: 0.9, fabric: 0.5 };
for (const s of SURFACES) def(`step_${s}`, footstep(s), { variants: 4, gain: STEP_GAIN[s], ref: 2.5, roll: 1.0, maxDist: 38, group: 'step', cap: 12, prio: 1, env: 0.15, pitchJit: 0.06, gainJit: 0.15, alt: s === 'concrete' ? null : ['step_concrete'] });
def('gear', gearRattle, { variants: 4, gain: 0.35, ref: 2.5, roll: 1.0, maxDist: 30, group: 'step', cap: 12, env: 0.1, pitchJit: 0.08 });
def('jump', jump, { variants: 2, gain: 0.45, group: 'body', cap: 4, prio: 2, env: 0.1 });
def('land', land, { variants: 3, gain: 0.8, ref: 2, maxDist: 35, group: 'body', cap: 4, prio: 2, env: 0.2 });
def('slide', slide, { variants: 2, gain: 0.6, ref: 2, maxDist: 30, group: 'body', cap: 4, prio: 2, env: 0.15, pitchJit: 0.04 });

// Einschläge
for (const s of SURFACES) def(`impact_${s}`, impact(s), { variants: 3, gain: 0.62, ref: 3, roll: 1.2, maxDist: 75, group: 'impact', cap: 12, prio: 1, env: 0.3, pitchJit: 0.07, gainJit: 0.15, alt: s === 'concrete' ? null : ['impact_concrete'] });

// Körper
def('hit_flesh', hitFlesh, { variants: 4, gain: 0.62, ref: 2, roll: 1.3, maxDist: 45, group: 'flesh', cap: 6, prio: 2, env: 0.12, pitchJit: 0.06, rate: 24000 });
def('hit_helmet', hitHelmet, { variants: 3, gain: 0.6, ref: 2.5, maxDist: 60, group: 'flesh', cap: 6, prio: 2, env: 0.2, pitchJit: 0.02 });
def('pain', pain, { variants: 6, variantsLow: 4, gain: 0.65, ref: 2.5, roll: 1.3, maxDist: 35, group: 'voice', cap: 4, prio: 1, env: 0.15, pitchJit: 0.04, rate: 24000 });
def('death', death, { variants: 3, gain: 0.8, ref: 3, roll: 1.2, maxDist: 45, group: 'voice', cap: 4, prio: 1, env: 0.2, pitchJit: 0.04 });
def('heartbeat', heartbeat, { gain: 0.45, group: 'vital', cap: 3, prio: 3, env: 0, pitchJit: 0.01, gainJit: 0, rate: 16000 });
def('breath_in', breathIn, { variants: 2, gain: 0.4, group: 'vital', cap: 3, prio: 3, env: 0, pitchJit: 0.03, rate: 32000 });
def('breath_out', breathOut, { variants: 2, gain: 0.4, group: 'vital', cap: 3, prio: 3, env: 0, pitchJit: 0.03, rate: 16000 });

// Spiel-Feedback (ungedämpft, folgt sfxVolume)
const FB_GAIN = {
  hitmarker: 0.62, hitmarker_kill: 0.42, headshot: 0.55, medal: 0.5, levelup: 0.7, streak_ready: 0.26, uav: 0.55, uav_end: 0.35,
  airstrike: 0.8, sentry: 0.55, capture: 0.55, capture_lost: 0.5, countdown: 0.45, go: 0.6, win: 0.62, lose: 0.62, draw: 0.6, spawn: 0.3, tinnitus: 0.4,
};
const FB_VARIANTS = { hitmarker: 3, hitmarker_kill: 2, headshot: 2 };
const FB_RATE = {
  medal: 32000, levelup: 32000, go: 32000, sentry: 32000, streak_ready: 24000, uav: 24000, airstrike: 24000, countdown: 24000, spawn: 24000,
  capture: 22050, capture_lost: 22050, win: 22050, uav_end: 16000, lose: 16000, draw: 16000, tinnitus: 16000,
};
const FB_ALT = { hitmarker_kill: ['hitmarker'], headshot: ['hitmarker_kill', 'hitmarker'] };
const END_ONLY = new Set(['win', 'lose', 'draw', 'levelup']); // nur auf dem Endbildschirm → bei Bedarf rendern, im Match freigeben
for (const [name, fn] of Object.entries(FEEDBACK)) {
  const marker = name.startsWith('hit') || name === 'headshot';
  def(name, fn, {
    variants: FB_VARIANTS[name] || 1, rate: FB_RATE[name] || RATE_FULL, gain: FB_GAIN[name] ?? 0.6, bus: 'fb', group: marker ? 'marker' : 'stinger', cap: 4, prio: 3, env: 0,
    pitchJit: marker ? 0.02 : 0, gainJit: 0.03, tier: marker ? 0 : END_ONLY.has(name) ? 4 : 2, transient: END_ONLY.has(name), alt: FB_ALT[name] || null,
  });
}
CATALOG.levelup.bus = 'ui';

// Menü (winzig: außerhalb des Spiels notfalls synchron)
const UI_GAIN = { hover: 0.32, click: 0.5, toggle: 0.42, confirm: 0.38, back: 0.36, error: 0.4 };
const UI_RATE = { confirm: 32000, toggle: 22050, back: 22050, error: 22050 };
for (const [name, fn] of Object.entries(UI_RECIPES)) def(name, fn, { variants: name === 'hover' ? 3 : name === 'click' ? 2 : 1, gain: UI_GAIN[name], bus: 'ui', group: 'ui', cap: 4, prio: 3, env: 0, pitchJit: 0.01, gainJit: 0.03, tier: 0, cheap: true, rate: UI_RATE[name] || RATE_FULL });

// Atmo-Ereignisse (nur die der aktuellen Karte werden gerendert)
const AMB_VARIANTS = { amb_gull: 4, amb_bird: 5, amb_dog: 3, amb_drip: 4, amb_creak: 2, amb_clank: 2, amb_chime: 2, amb_flap: 2, amb_steam: 2, amb_groan: 2, amb_arc: 2, amb_crow: 2 };
const AMB_VARIANTS_LOW = { amb_gull: 3, amb_bird: 3, amb_drip: 3 };
for (const [name, fn] of Object.entries(AMB_EVENTS)) {
  def(name, fn, { variants: AMB_VARIANTS[name] || 1, variantsLow: AMB_VARIANTS_LOW[name] || 0, bus: 'amb', rate: EVENT_RATE[name] || 32000, ref: 20, roll: 1, maxDist: 5000, group: 'amb', cap: 8, prio: 0, env: 0, pitchJit: 0.05, tier: 3 });
}
Object.assign(CATALOG.loop_drone, { bus: 'sfx', group: 'loop', prio: 2, env: 0.2, tier: 4 }); // nur Prüfstand/Objekte

// Atmo-Schleifen und Musik-Stems (nur bei Bedarf; Musik nur in Menüs → im Match freigegeben)
for (const id of Object.keys(AMBIENCES)) def(`amb_bed_${id}`, (sr, R) => ambienceBed(id, sr, R), { bus: 'amb', rate: BED_RATE[id] || 22050, group: 'bed', cap: 4, prio: 0, env: 0, pitchJit: 0, gainJit: 0, tier: 4 });
for (const id of STEM_IDS) def(`mus_${id}`, STEMS[id], { bus: 'music', rate: STEM_SR[id], group: 'music', cap: 16, prio: 3, env: 0, pitchJit: 0, gainJit: 0, tier: 4, transient: true });

/** Gruppierte Namen für Prüfstand/Dev-Board. */
export const SOUND_GROUPS = {
  Waffen: Object.keys(GUN_PROFILES),
  Handling: ['dryfire', 'reload_mag_out', 'reload_mag_in', 'reload_bolt', 'reload_shell', 'pump', 'bolt', 'equip', 'ads_in', 'ads_out', 'melee_swing', 'melee_hit', 'grenade_pin', 'grenade_throw', 'grenade_bounce', 'grenade_stick', 'low_ammo'],
  Explosion: ['explosion', 'explosion_far'],
  Geschosse: ['bullet_whiz', 'bullet_crack'],
  Schritte: SURFACES.map(s => `step_${s}`).concat(['gear', 'jump', 'land', 'slide']),
  Einschläge: SURFACES.map(s => `impact_${s}`),
  Körper: ['hit_flesh', 'hit_helmet', 'pain', 'death', 'heartbeat', 'breath_in', 'breath_out'],
  Feedback: Object.keys(FEEDBACK),
  Menü: Object.keys(UI_RECIPES),
  Atmosphäre: Object.keys(AMB_EVENTS),
};

export { GUN_PROFILES, SURFACES, AMBIENCES, STEM_IDS };
