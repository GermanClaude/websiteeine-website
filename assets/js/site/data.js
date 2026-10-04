// Defensiver Lader für die geteilten Datenmodule. Jedes Modul darf fehlen oder unvollständig sein:
// Die Seite bekommt dann Rückfalldaten und zeigt pro Abschnitt „KEIN SIGNAL.“.

const DEBUG = /[?&]debug=1/.test(location.search);
const log = (...a) => { if (DEBUG) console.info('[NULLPUNKT data]', ...a); };

const ROSTER = ['ar_kv47', 'ar_m17', 'smg_vp9', 'smg_qx90', 'lmg_hm60', 'mr_sk14', 'sr_brecher', 'sg_bulldog', 'pi_p9', 'pi_adler', 'knife'];
const MAP_IDS = ['hafen', 'altstadt', 'werk', 'range'];

/* Statische Rückfalltabellen (Vertrag §2/§9) */
const STATIC_MODES = {
  tdm: { id: 'tdm', name: 'Team-Deathmatch', short: 'TDM', teams: true, defaultAllies: 5, defaultEnemies: 6, limits: { allies: [0, 7], enemies: [1, 8] }, scoreLimit: 40, scoreUnit: 'Abschüsse', timeLimit: 600, recommendedMaps: ['hafen', 'altstadt', 'werk'], tagline: 'Sechs gegen sechs. Wer zuerst 40 erreicht, gewinnt.', description: '', rules: [] },
  dom: { id: 'dom', name: 'Herrschaft', short: 'DOM', teams: true, defaultAllies: 5, defaultEnemies: 6, limits: { allies: [0, 7], enemies: [1, 8] }, scoreLimit: 150, scoreUnit: 'Punkte', timeLimit: 600, recommendedMaps: ['werk', 'hafen', 'altstadt'], tagline: 'Drei Flaggen. Halte zwei, und die Uhr arbeitet für dich.', description: '', rules: [] },
  ffa: { id: 'ffa', name: 'Jeder gegen jeden', short: 'FFA', teams: false, defaultAllies: 0, defaultEnemies: 7, limits: { allies: [0, 0], enemies: [1, 11] }, scoreLimit: 25, scoreUnit: 'Abschüsse', timeLimit: 600, recommendedMaps: ['altstadt', 'werk', 'hafen'], tagline: 'Acht Spieler. Keine Freunde. 25 Abschüsse.', description: '', rules: [] },
  gun: { id: 'gun', name: 'Waffenspiel', short: 'GUN', teams: false, defaultAllies: 0, defaultEnemies: 7, limits: { allies: [0, 0], enemies: [1, 11] }, scoreLimit: 18, scoreUnit: 'Stufen', timeLimit: 600, recommendedMaps: ['altstadt', 'werk', 'hafen'], tagline: '18 Stufen, ein Messer. Jeder Abschuss lädt nach.', description: '', rules: [] },
  training: { id: 'training', name: 'Schießstand', short: 'TRN', teams: false, defaultAllies: 0, defaultEnemies: 0, limits: { allies: [0, 0], enemies: [0, 0] }, scoreLimit: 0, scoreUnit: 'Treffer', timeLimit: 0, recommendedMaps: ['range'], tagline: 'Kein Druck, kein Limit. Nur du und die Ziele.', description: '', rules: [] },
};
const STATIC_DIFF = {
  rekrut: { id: 'rekrut', name: 'Rekrut' }, regulaer: { id: 'regulaer', name: 'Regulär' },
  veteran: { id: 'veteran', name: 'Veteran' }, elite: { id: 'elite', name: 'Elite' },
};
const STATIC_MAPS = {
  hafen: { id: 'hafen', name: 'Hafen', modes: ['tdm', 'ffa', 'dom', 'gun'], layout: [] },
  altstadt: { id: 'altstadt', name: 'Altstadt', modes: ['tdm', 'ffa', 'dom', 'gun'], layout: [] },
  werk: { id: 'werk', name: 'Werk', modes: ['tdm', 'ffa', 'dom', 'gun'], layout: [] },
  range: { id: 'range', name: 'Schießstand', modes: ['training'], layout: [] },
};
const SETTINGS_DEFAULTS = {
  playerName: 'Operator', sensitivity: 1.0, adsSensitivity: 0.85, touchSensitivity: 1.0, invertY: false, fov: 80,
  quality: 'auto', masterVolume: 0.8, sfxVolume: 1.0, musicVolume: 0.5, uiVolume: 0.7, crosshairStyle: 'cross',
  crosshairColor: '#ffffff', showFps: false, aimAssist: true, autoFire: false, difficulty: 'regulaer',
  lastMode: 'tdm', lastMap: 'hafen', lastLoadout: null, reducedMotion: false,
};

function memorySettings() {
  let values = { ...SETTINGS_DEFAULTS };
  const fns = new Set();
  const notify = (k, v) => { for (const fn of fns) { try { fn(k, v, values); } catch { /* egal */ } } };
  return {
    persistent: false, fallback: true, defaults: SETTINGS_DEFAULTS,
    get: (k) => values[k],
    set(k, v) { if (!(k in values) || values[k] === v) return values[k]; values = { ...values, [k]: v }; notify(k, v); return v; },
    patch(o) { for (const [k, v] of Object.entries(o || {})) this.set(k, v); return { ...values }; },
    all: () => ({ ...values }),
    reset() { const prev = values; values = { ...SETTINGS_DEFAULTS }; for (const k of Object.keys(values)) if (prev[k] !== values[k]) notify(k, values[k]); },
    onChange(fn) { fns.add(fn); return () => fns.delete(fn); },
    validate: (k, v) => v,
  };
}

async function imp(path) {
  try { return await import(path); } catch (err) { log('fehlt:', path, err?.message); return null; }
}

/** Normalisiert einen Kartenblock auf { x, z, w, d, kind, rot } (x/z = Mittelpunkt, Meter). */
export function normBlock(b) {
  if (!b) return null;
  let o;
  if (Array.isArray(b)) {
    const [x, z, w, d, kind, rot] = b;
    o = { x, z, w, d, kind, rot };
  } else if (typeof b === 'object') {
    o = { x: b.x, z: b.z ?? b.y, w: b.w ?? b.width, d: b.d ?? b.depth, kind: b.kind ?? b.type, rot: b.rot ?? b.rotation };
  } else return null;
  for (const k of ['x', 'z', 'w', 'd']) { o[k] = Number(o[k]); if (!Number.isFinite(o[k])) return null; }
  if (o.w <= 0 || o.d <= 0) return null;
  o.kind = String(o.kind || 'cover');
  o.rot = Number.isFinite(Number(o.rot)) ? Number(o.rot) : 0;
  return o;
}

let promise = null;

/** Lädt alles parallel. Ergebnis: { W, M, P, settings, profile, profileMod, ok }. */
export function loadData() {
  if (promise) return promise;
  promise = (async () => {
    const [W, M, P, S, PR] = await Promise.all([
      imp('../shared/weapons.data.js'), imp('../shared/modes.data.js'), imp('../shared/maps.data.js'),
      imp('../shared/settings.js'), imp('../shared/profile.js'),
    ]);
    const ok = { weapons: false, modes: false, maps: false, settings: false, profile: false };

    // Waffen
    let weapons = null;
    if (W?.WEAPONS && typeof W.WEAPONS === 'object') {
      const ids = (Array.isArray(W.WEAPON_IDS) ? W.WEAPON_IDS : Object.keys(W.WEAPONS)).filter((id) => W.WEAPONS[id]);
      const missing = ROSTER.filter((id) => !W.WEAPONS[id]);
      const extra = ids.filter((id) => !ROSTER.includes(id));
      if (missing.length) log('Waffen fehlen:', missing);
      if (extra.length) log('Unbekannte Waffen (werden gezeigt):', extra);
      for (const id of ids) {
        const d = W.WEAPONS[id];
        if (!d.stats) d.stats = { damage: 50, fireRate: 50, range: 50, accuracy: 50, mobility: 50, control: 50 };
        if (!d.recoil) d.recoil = { vertical: 0.01, horizontal: 0.004, recovery: 8, firstShotMult: 1 };
        if (!d.damage) d.damage = { max: 25, min: 20, rangeStart: 20, rangeEnd: 40 };
      }
      weapons = { ...W, WEAPON_IDS: ids };
      ok.weapons = ids.length > 0;
    }

    // Modi
    let modes;
    if (M?.MODES && Array.isArray(M.MODE_ORDER)) {
      const order = M.MODE_ORDER.filter((id) => M.MODES[id]);
      for (const id of order) {
        const m = M.MODES[id];
        const s = STATIC_MODES[id];
        if (!m.limits && s) m.limits = s.limits;
        if (m.defaultAllies === undefined && s) m.defaultAllies = s.defaultAllies;
        if (m.defaultEnemies === undefined && s) m.defaultEnemies = s.defaultEnemies;
        if (!Array.isArray(m.recommendedMaps)) m.recommendedMaps = s?.recommendedMaps || [];
      }
      modes = { ...M, MODE_ORDER: order };
      ok.modes = order.length > 0;
    } else {
      modes = { MODES: STATIC_MODES, MODE_ORDER: ['tdm', 'dom', 'ffa', 'gun', 'training'], STREAKS: {}, STREAK_ORDER: [], MEDALS: {} };
    }
    if (!modes.DIFFICULTIES || !Array.isArray(modes.DIFFICULTY_ORDER)) {
      modes.DIFFICULTIES = STATIC_DIFF;
      modes.DIFFICULTY_ORDER = Object.keys(STATIC_DIFF);
    }
    if (typeof modes.formatTimeLimit !== 'function') {
      modes.formatTimeLimit = (s) => (s ? `${Math.round(s / 60)} Minuten` : 'kein Limit');
    }

    // Karten
    let maps;
    if (P?.MAPS && typeof P.MAPS === 'object') {
      const order = (Array.isArray(P.MAP_ORDER) ? P.MAP_ORDER : Object.keys(P.MAPS)).filter((id) => P.MAPS[id]);
      for (const id of order) {
        const m = P.MAPS[id];
        if (!Array.isArray(m.modes)) m.modes = STATIC_MAPS[id]?.modes || [];
        m.blocks = (Array.isArray(m.layout) ? m.layout : []).map(normBlock).filter(Boolean);
      }
      const missing = MAP_IDS.filter((id) => !P.MAPS[id]);
      if (missing.length) log('Karten fehlen:', missing);
      maps = { ...P, MAP_ORDER: order };
      ok.maps = order.length > 0;
    } else {
      for (const m of Object.values(STATIC_MAPS)) m.blocks = [];
      maps = { MAPS: STATIC_MAPS, MAP_ORDER: MAP_IDS };
    }

    // Einstellungen & Profil
    let settings = S?.settings;
    if (settings && typeof settings.get === 'function' && typeof settings.onChange === 'function') ok.settings = true;
    else settings = memorySettings();
    const schema = S?.SETTINGS_SCHEMA || settings.schema || null;

    const profile = PR?.profile && typeof PR.profile.get === 'function' ? PR.profile : null;
    ok.profile = !!profile;

    return { W: weapons, M: modes, P: maps, settings, schema, profile, profileMod: PR, ok };
  })();
  return promise;
}

/** Map-Ids, die ein Modus erlaubt (Regeln aus §01). */
export function mapsForMode(D, modeId) {
  const { MAPS, MAP_ORDER } = D.P;
  if (modeId === 'training') return MAP_ORDER.includes('range') ? ['range'] : MAP_ORDER.filter((id) => (MAPS[id].modes || []).includes('training'));
  let ids = MAP_ORDER.filter((id) => (MAPS[id].modes || []).includes(modeId));
  if (!ids.length) ids = (D.M.MODES[modeId]?.recommendedMaps || []).filter((id) => MAPS[id] && id !== 'range');
  if (!ids.length) ids = MAP_ORDER.filter((id) => id !== 'range');
  return ids.filter((id) => id !== 'range');
}
