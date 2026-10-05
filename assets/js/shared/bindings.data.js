// NULLPUNKT — Steuerung als reine Daten (Spiel + Website, ohne three.js): Aktionen, Standardbelegung für
// Tastatur/Maus und Gamepad, deutsche Beschriftungen, Konfliktprüfung, Änderungen an der Belegung
// (Überschreibungen in settings.bindings), Touch-Knöpfe und Touch-Layout-Vorlagen (settings.touchLayout).
//
// Codes:
//   Tastatur  KeyboardEvent.code („KeyW“, „Space“, „ShiftLeft“ …) – physische Taste, Beschriftung je Layout
//   Maus      „Mouse0“ … „Mouse4“ (LMT, MMT, RMT, Seitentaste 4/5), „Wheel“ (beide Richtungen), „WheelUp“, „WheelDown“
//   Gamepad   „Pad0“ … „Pad15“ (W3C-Standard-Mapping, Trigger Pad6/Pad7 ab 35 % Druck)
//   Akkord    „Pad6+Pad10“ = Pad10 drücken, während Pad6 gehalten wird (die einfache Belegung von Pad10 entfällt dann)
// Überschreibungen: { kb: { [aktion]: [codes] }, pad: { … } } – nur abweichende Aktionen; [] = nicht belegt.

export const BINDINGS_VERSION = 1;
/** Höchstzahl Codes je Aktion und Gerät. */
export const MAX_SLOTS = 3;
export const DEVICES = Object.freeze(['kb', 'pad']);

/**
 * Alle Aktionen. group: bewegung | kampf | serien | sonstiges. modes: Halten/Umschalten wählbar
 * (Einstellung `<modeKey>`), fixed: nicht änderbar (Pause bleibt Esc/Menü).
 */
export const ACTION_DEFS = Object.freeze([
  { id: 'move_forward', label: 'Vorwärts', group: 'bewegung' },
  { id: 'move_back', label: 'Rückwärts', group: 'bewegung' },
  { id: 'move_left', label: 'Links', group: 'bewegung' },
  { id: 'move_right', label: 'Rechts', group: 'bewegung' },
  { id: 'sprint', label: 'Sprinten (im Zielfernrohr: Atem anhalten)', short: 'Sprinten', group: 'bewegung', modeKey: 'sprintMode' },
  { id: 'jump', label: 'Springen / Überklettern', group: 'bewegung' },
  { id: 'crouch', label: 'Ducken (im Sprint: rutschen)', short: 'Ducken', group: 'bewegung', modeKey: 'crouchMode' },
  { id: 'prone', label: 'Hinlegen (Controller: Ducken halten)', short: 'Hinlegen', group: 'bewegung' },
  { id: 'lean_left', label: 'Nach links lehnen', short: 'Links lehnen', group: 'bewegung', modeKey: 'leanMode' },
  { id: 'lean_right', label: 'Nach rechts lehnen', short: 'Rechts lehnen', group: 'bewegung', modeKey: 'leanMode' },
  { id: 'fire', label: 'Feuern', group: 'kampf' },
  { id: 'ads', label: 'Zielen (Anlegen)', short: 'Zielen', group: 'kampf', modeKey: 'adsMode' },
  { id: 'reload', label: 'Nachladen', group: 'kampf' },
  { id: 'melee', label: 'Nahkampf', group: 'kampf' },
  { id: 'grenade', label: 'Granate (halten: vorkochen)', short: 'Granate', group: 'kampf' },
  { id: 'tactical', label: 'Taktische Granate', short: 'Taktisch', group: 'kampf' },
  { id: 'swap', label: 'Waffe wechseln', group: 'kampf' },
  { id: 'slot1', label: 'Primärwaffe', group: 'kampf' },
  { id: 'slot2', label: 'Zweitwaffe', group: 'kampf' },
  { id: 'light', label: 'Lampe / Laser', short: 'Lampe', group: 'kampf' },
  { id: 'plate', label: 'Panzerplatte einsetzen (halten: alle)', short: 'Platte', group: 'kampf' },
  { id: 'gadget', label: 'Klassen-Ausrüstung (Spritze, Verbandskasten, Reparatur, Markieren)', short: 'Ausrüstung', group: 'kampf' },
  { id: 'streak1', label: 'Serienprämie 1 (Aufklärer)', short: 'Serie 1', group: 'serien' },
  { id: 'streak2', label: 'Serienprämie 2 (Präzisionsschlag)', short: 'Serie 2', group: 'serien' },
  { id: 'streak3', label: 'Serienprämie 3 (Wachgeschütz)', short: 'Serie 3', group: 'serien' },
  { id: 'interact', label: 'Interagieren', group: 'sonstiges' },
  { id: 'inspect', label: 'Waffe inspizieren (nur PC)', short: 'Inspizieren', group: 'sonstiges' },
  { id: 'loadout', label: 'Ausrüsten (nach dem Tod / im Pausemenü)', short: 'Ausrüsten', group: 'sonstiges' },
  { id: 'squad_order', label: 'Trupp-Befehl (Flagge im Blick angreifen/verteidigen, Eroberung)', short: 'Befehl', group: 'sonstiges' },
  { id: 'scoreboard', label: 'Punktetabelle', group: 'sonstiges' },
  { id: 'fullscreen', label: 'Vollbild umschalten (auch Alt + Eingabe)', short: 'Vollbild', group: 'sonstiges' },
  { id: 'pause', label: 'Pause', group: 'sonstiges', fixed: true },
]);
export const ACTION_IDS = Object.freeze(ACTION_DEFS.map((a) => a.id));
export const ACTION_BY_ID = Object.freeze(Object.fromEntries(ACTION_DEFS.map((a) => [a.id, a])));
export const ACTION_GROUPS = Object.freeze({ bewegung: 'Bewegung', kampf: 'Kampf', serien: 'Serienprämien', sonstiges: 'Sonstiges' });
export const MOVE_ACTIONS = Object.freeze(['move_forward', 'move_back', 'move_left', 'move_right']);

/**
 * Standardbelegung (Bodycam-nah, Plan S2): Q/E lehnen, G Granate, X taktisch, T Lampe, F interagieren, V Nahkampf, C ducken.
 * Gamepad wie CoD: LB Granate, RB taktisch, R3 Nahkampf, L3 Sprint; Lehnen = LT halten + L3/R3 (wie Siege).
 */
export const DEFAULT_BINDINGS = deepFreeze({
  kb: {
    move_forward: ['KeyW', 'ArrowUp'], move_back: ['KeyS', 'ArrowDown'], move_left: ['KeyA', 'ArrowLeft'], move_right: ['KeyD', 'ArrowRight'],
    sprint: ['ShiftLeft', 'ShiftRight'], jump: ['Space'], crouch: ['KeyC'], lean_left: ['KeyQ'], lean_right: ['KeyE'],
    fire: ['Mouse0'], ads: ['Mouse2'], reload: ['KeyR'], melee: ['KeyV', 'Mouse3'], grenade: ['KeyG'], tactical: ['KeyX'],
    swap: ['Mouse4', 'Wheel'], slot1: ['Digit1'], slot2: ['Digit2'], light: ['KeyT'],
    streak1: ['Digit3'], streak2: ['Digit4'], streak3: ['Digit5'], interact: ['KeyF'], scoreboard: ['Tab'], pause: ['Escape'], fullscreen: ['F11'],
    prone: ['KeyZ'], plate: ['Digit4'], gadget: ['KeyB'], inspect: ['KeyI'], loadout: ['KeyL'], squad_order: ['Mouse1', 'KeyH'],
  },
  pad: {
    move_forward: [], move_back: [], move_left: [], move_right: [],
    sprint: ['Pad10'], jump: ['Pad0'], crouch: ['Pad1'], lean_left: ['Pad6+Pad10'], lean_right: ['Pad6+Pad11'],
    fire: ['Pad7'], ads: ['Pad6'], reload: ['Pad2'], melee: ['Pad11'], grenade: ['Pad4'], tactical: ['Pad5'],
    swap: ['Pad3'], slot1: [], slot2: [], light: ['Pad13'],
    streak1: ['Pad12'], streak2: ['Pad14'], streak3: ['Pad15'], interact: ['Pad2'], scoreboard: ['Pad8'], pause: ['Pad9'], fullscreen: [],
    prone: [], plate: ['Pad13'], gadget: ['Pad6+Pad3'], inspect: [], loadout: ['Pad3'], squad_order: [],
  },
});

/** Aktionspaare, die sich eine Taste teilen dürfen (kein Konflikt): X = Nachladen + Interagieren wie in CoD. */
// Platte teilt sich 4 mit Serie 2 bzw. ▼ mit der Lampe: player.js entscheidet (Serie bereit → Serie; Platte nötig → Platte).
// Ausrüsten teilt Y mit dem Waffenwechsel (nur nach dem Tod/in Menüs wirksam).
export const ALLOWED_SHARES = Object.freeze([['reload', 'interact'], ['plate', 'streak2'], ['plate', 'light'], ['loadout', 'swap']]);
const shareOk = (a, b) => ALLOWED_SHARES.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/** Nicht belegbar: Esc (verlässt den Pointer-Lock), Browser-/Systemtasten, Home-Taste des Gamepads. */
export const RESERVED_CODES = Object.freeze(['Escape', 'F5', 'F11', 'F12', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight', 'ContextMenu', 'Pad9', 'Pad16']);
/** Belegbar, aber riskant – Hinweistext für die Oberfläche. */
const WARNINGS = {
  ControlLeft: 'Achtung: Strg + W schließt im Browser den Tab, Strg + T/N öffnen neue – das kann eine Webseite nicht verhindern.',
  ControlRight: 'Achtung: Strg + W schließt im Browser den Tab – das kann eine Webseite nicht verhindern.',
  AltLeft: 'Achtung: Alt öffnet in manchen Browsern das Menü.',
  Tab: null,
};

/* ------------------------------------------------------------------ Codes */

const CODE_RE = /^[A-Za-z][A-Za-z0-9]{0,23}$/;

/** Gerät eines Codes: 'pad' | 'kb' | null (ungültig). Akkorde: beide Teile vom selben Gerät. */
export function codeDevice(code) {
  if (typeof code !== 'string' || code.length > 40) return null;
  const parts = code.split('+');
  if (parts.length > 2 || !parts.every((p) => CODE_RE.test(p))) return null;
  const pad = parts.map((p) => /^Pad\d{1,2}$/.test(p));
  if (pad.every(Boolean)) return 'pad';
  if (pad.some(Boolean)) return null;
  return 'kb';
}

/** Ist `code` für `device` belegbar? (Pause darf ihre reservierte Taste behalten.) */
export function isBindable(code, device, action = null) {
  if (codeDevice(code) !== device) return false;
  if (action === 'pause') return true;
  if (action === 'fullscreen' && code === 'F11') return true; // F11: Vollbild (engine/fullscreen.js fängt sie ab)
  return !code.split('+').some((p) => RESERVED_CODES.includes(p));
}

/** Warnhinweis zu einer Taste (deutsch) oder null. */
export function codeWarning(code) {
  return (code && WARNINGS[code.split('+').pop()]) || null;
}

const KEY_NAMES = {
  Space: ['Leertaste', 'Leertaste'], ShiftLeft: ['Umschalt', 'Umschalt links'], ShiftRight: ['Umschalt', 'Umschalt rechts'],
  ControlLeft: ['Strg', 'Strg links'], ControlRight: ['Strg', 'Strg rechts'], AltLeft: ['Alt', 'Alt'], AltRight: ['Alt Gr', 'Alt Gr'],
  Tab: ['Tab', 'Tabulator'], CapsLock: ['Feststell', 'Feststelltaste'], Enter: ['Eingabe', 'Eingabetaste'], NumpadEnter: ['Num Eingabe', 'Ziffernblock Eingabe'],
  Backspace: ['Rücktaste', 'Rücktaste'], Escape: ['Esc', 'Escape'], Insert: ['Einfg', 'Einfügen'], Delete: ['Entf', 'Entfernen'],
  Home: ['Pos1', 'Pos1'], End: ['Ende', 'Ende'], PageUp: ['Bild ↑', 'Bild hoch'], PageDown: ['Bild ↓', 'Bild runter'],
  ArrowUp: ['↑', 'Pfeil hoch'], ArrowDown: ['↓', 'Pfeil runter'], ArrowLeft: ['←', 'Pfeil links'], ArrowRight: ['→', 'Pfeil rechts'],
  // Deutsches QWERTZ-Layout (ohne Layout-Karte des Browsers)
  Backquote: ['^', 'Zirkumflex'], Minus: ['ß', 'ß'], Equal: ['´', 'Akut'], BracketLeft: ['Ü', 'Ü'], BracketRight: ['+', 'Plus'],
  Semicolon: ['Ö', 'Ö'], Quote: ['Ä', 'Ä'], Backslash: ['#', 'Raute'], IntlBackslash: ['<', 'Kleiner-als'], Comma: [',', 'Komma'],
  Period: ['.', 'Punkt'], Slash: ['-', 'Minus'], ContextMenu: ['Menü', 'Menütaste'], MetaLeft: ['Win', 'Systemtaste'], MetaRight: ['Win', 'Systemtaste'],
  NumpadAdd: ['Num +', 'Ziffernblock Plus'], NumpadSubtract: ['Num −', 'Ziffernblock Minus'], NumpadMultiply: ['Num ×', 'Ziffernblock Mal'],
  NumpadDivide: ['Num ÷', 'Ziffernblock Geteilt'], NumpadDecimal: ['Num ,', 'Ziffernblock Komma'],
};
const MOUSE_NAMES = {
  Mouse0: ['LMT', 'Linke Maustaste'], Mouse1: ['MMT', 'Mittlere Maustaste'], Mouse2: ['RMT', 'Rechte Maustaste'],
  Mouse3: ['Maus 4', 'Maustaste 4 (zurück)'], Mouse4: ['Maus 5', 'Maustaste 5 (vor)'],
  Wheel: ['Mausrad', 'Mausrad'], WheelUp: ['Rad ↑', 'Mausrad hoch'], WheelDown: ['Rad ↓', 'Mausrad runter'],
};
/** Gamepad-Tasten im Standard-Mapping: [Xbox-Stil, PlayStation-Stil]. */
export const PAD_BUTTON_NAMES = Object.freeze([
  ['A', '✕'], ['B', '○'], ['X', '□'], ['Y', '△'], ['LB', 'L1'], ['RB', 'R1'], ['LT', 'L2'], ['RT', 'R2'],
  ['Ansicht', 'Create'], ['Menü', 'Options'], ['L3', 'L3'], ['R3', 'R3'], ['▲', '▲'], ['▼', '▼'], ['◀', '◀'], ['▶', '▶'], ['Home', 'PS'],
]);

/**
 * Beschriftung eines Codes. opts: { long: false, pad: 'xbox'|'ps', layout: Map|null (navigator.keyboard.getLayoutMap()) }
 * „KeyZ“ heißt auf QWERTZ „Y“ – mit Layout-Karte stimmt jede Tastatur.
 */
export function codeLabel(code, { long = false, pad = 'xbox', layout = null } = {}) {
  if (!code) return '—';
  if (code.includes('+')) return code.split('+').map((c) => codeLabel(c, { long, pad, layout })).join(' + ');
  const m = /^Pad(\d{1,2})$/.exec(code);
  if (m) {
    const n = PAD_BUTTON_NAMES[Number(m[1])];
    return n ? n[pad === 'ps' ? 1 : 0] : `Taste ${m[1]}`;
  }
  if (MOUSE_NAMES[code]) return MOUSE_NAMES[code][long ? 1 : 0];
  if (layout && typeof layout.get === 'function') {
    const k = layout.get(code);
    if (k && k.trim() && !/^\s$/.test(k)) return k.length === 1 ? k.toUpperCase() : k;
  }
  if (KEY_NAMES[code]) return KEY_NAMES[code][long ? 1 : 0];
  let r;
  if ((r = /^Key([A-Z])$/.exec(code))) return r[1] === 'Z' ? 'Y' : r[1] === 'Y' ? 'Z' : r[1]; // QWERTZ
  if ((r = /^Digit(\d)$/.exec(code))) return r[1];
  if ((r = /^Numpad(\d)$/.exec(code))) return long ? `Ziffernblock ${r[1]}` : `Num ${r[1]}`;
  if (/^F\d{1,2}$/.test(code)) return code;
  return code;
}

/* -------------------------------------------------------------- Auflösen */

function cleanList(list, device, action) {
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    if (typeof c === 'string' && isBindable(c, device, action) && !out.includes(c)) out.push(c);
    if (out.length >= MAX_SLOTS) break;
  }
  return out;
}

/** Standard + Überschreibungen → { kb: {aktion: [codes]}, pad: {…} } (feste Aktionen immer Standard). */
export function resolveBindings(overrides) {
  const out = { kb: {}, pad: {} };
  for (const dev of DEVICES) {
    const o = overrides && typeof overrides === 'object' ? overrides[dev] : null;
    for (const a of ACTION_IDS) {
      const def = DEFAULT_BINDINGS[dev][a] || [];
      const own = o && Array.isArray(o[a]) && !ACTION_BY_ID[a].fixed ? o[a] : null;
      out[dev][a] = own ? cleanList(own, dev, a) : [...def];
    }
  }
  return out;
}

/** Code → Aktionen eines Geräts (für die Eingabe). Akkorde zusätzlich unter `chords` (Auslöser → [{mod, actions}]). */
export function codeMap(resolved, device) {
  const plain = new Map();
  const chords = new Map();
  const table = resolved[device] || {};
  for (const a of ACTION_IDS) {
    for (const code of table[a] || []) {
      if (code.includes('+')) {
        const [mod, trig] = code.split('+');
        let list = chords.get(trig);
        if (!list) chords.set(trig, (list = []));
        let e = list.find((x) => x.mod === mod);
        if (!e) list.push((e = { mod, actions: [] }));
        if (!e.actions.includes(a)) e.actions.push(a);
      } else {
        let l = plain.get(code);
        if (!l) plain.set(code, (l = []));
        if (!l.includes(a)) l.push(a);
      }
    }
  }
  return { plain, chords };
}

/** Konflikte: dieselbe Taste für mehrere Aktionen eines Geräts (erlaubte Paare ausgenommen). */
export function findConflicts(resolved) {
  const out = [];
  for (const dev of DEVICES) {
    const by = new Map();
    for (const a of ACTION_IDS) for (const c of resolved[dev][a] || []) { if (!by.has(c)) by.set(c, []); by.get(c).push(a); }
    for (const [code, actions] of by) {
      if (actions.length < 2) continue;
      const clash = actions.filter((a) => actions.some((b) => b !== a && !shareOk(a, b)));
      if (clash.length >= 2) out.push({ device: dev, code, actions: clash });
    }
  }
  return out;
}

/** Konflikte einer Aktion (für Markierungen in der Oberfläche): [{ code, with: [aktionen] }]. */
export function conflictsOf(resolved, device, action) {
  return findConflicts(resolved).filter((c) => c.device === device && c.actions.includes(action))
    .map((c) => ({ code: c.code, with: c.actions.filter((a) => a !== action) }));
}

/** Überschreibungen aus einer vollständigen Tabelle (nur Abweichungen vom Standard). */
export function diffBindings(resolved) {
  const out = {};
  for (const dev of DEVICES) {
    for (const a of ACTION_IDS) {
      if (ACTION_BY_ID[a].fixed) continue;
      const cur = resolved[dev][a] || [];
      const def = DEFAULT_BINDINGS[dev][a] || [];
      if (cur.length === def.length && cur.every((c, i) => c === def[i])) continue;
      (out[dev] || (out[dev] = {}))[a] = [...cur];
    }
  }
  return out;
}

/**
 * Belegt Platz `slot` (0…MAX_SLOTS−1) der Aktion mit `code` (null = Platz leeren).
 * conflict: 'swap' (Standard: andere Aktion bekommt die bisherige Taste dieses Platzes), 'unbind' (andere Aktion
 * verliert die Taste) oder 'keep' (Doppelbelegung bleibt, wird als Konflikt gemeldet).
 * → { overrides, displaced: [{ action, code, replacement }], conflicts, ok }
 */
export function setBinding(overrides, device, action, slot, code, { conflict = 'swap' } = {}) {
  const cur = resolveBindings(overrides);
  const def = ACTION_BY_ID[action];
  if (!def || def.fixed || !DEVICES.includes(device) || (code != null && !isBindable(code, device, action))) {
    return { overrides: diffBindings(cur), displaced: [], conflicts: findConflicts(cur), ok: false };
  }
  const list = [...cur[device][action]];
  const i = Math.max(0, Math.min(MAX_SLOTS - 1, slot | 0));
  const old = list[i] ?? null;
  if (code == null) { if (i < list.length) list.splice(i, 1); }
  else {
    const dup = list.indexOf(code);
    if (dup >= 0 && dup !== i) list.splice(dup, 1);
    if (i < list.length) list[i] = code; else list.push(code);
  }
  cur[device][action] = list.slice(0, MAX_SLOTS);
  const displaced = [];
  if (code != null && conflict !== 'keep') {
    for (const b of ACTION_IDS) {
      if (b === action || shareOk(action, b) || ACTION_BY_ID[b].fixed) continue;
      const l = cur[device][b];
      const k = l.indexOf(code);
      if (k < 0) continue;
      const repl = conflict === 'swap' && old && old !== code && !l.includes(old) && isBindable(old, device, b) ? old : null;
      if (repl) l[k] = repl; else l.splice(k, 1);
      displaced.push({ action: b, code, replacement: repl });
    }
  }
  return { overrides: diffBindings(cur), displaced, conflicts: findConflicts(cur), ok: true };
}

/** Belegung eines Geräts (oder aller) zurücksetzen. */
export function resetBindings(overrides, device = null) {
  if (!device) return {};
  const out = {};
  for (const dev of DEVICES) if (dev !== device && overrides && overrides[dev]) out[dev] = JSON.parse(JSON.stringify(overrides[dev]));
  return out;
}

/** Bereinigt gespeicherte Überschreibungen (für settings.js). Unbrauchbar → undefined. */
export function sanitizeBindings(v) {
  if (v === null) return {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out = {};
  for (const dev of DEVICES) {
    const o = v[dev];
    if (!o || typeof o !== 'object') continue;
    for (const a of ACTION_IDS) {
      if (!Array.isArray(o[a]) || ACTION_BY_ID[a].fixed) continue;
      (out[dev] || (out[dev] = {}))[a] = cleanList(o[a], dev, a);
    }
  }
  return out;
}

/** Beschriftung der ersten Belegung einer Aktion, z. B. für HUD-Hinweise („F“, „X“). */
export function actionLabel(resolved, device, action, opts) {
  const list = (resolved && resolved[device] && resolved[device][action]) || [];
  return list.length ? codeLabel(list[0], opts) : '';
}

/* ================================================================ Touch-Layout */

/**
 * Touch-Knöpfe (engine/input.js baut sie in #touch-ui). sel = Element; kind: btn | group (Container) | stick.
 * optional: standardmäßig verborgen. auto: sichtbar, sobald die Funktion verfügbar ist ('tactical' = taktische
 * Granate in der Ausrüstung, 'light' = Lampe). def: Standardlage (Mitte in % der Fläche, s = Größe in --tc-u)
 * für Knöpfe ohne Lage in game.css (ui-controls: Lagen so gewählt, dass sie im Standard-Layout 16:9–20:9 nichts überdecken).
 */
export const TOUCH_BUTTONS = Object.freeze([
  { id: 'stick', sel: '.tc-stick', label: 'Joystick', kind: 'stick' },
  { id: 'fire', sel: '.tc-fire-r', label: 'Feuern (rechts)' },
  { id: 'fireL', sel: '.tc-fire-l', label: 'Feuern (links)' },
  { id: 'ads', sel: '.tc-ads', label: 'Zielen' },
  { id: 'adsfire', sel: '.tc-adsfire', label: 'Zielen + Feuern', optional: true, def: { x: 65, y: 60, s: 56 } },
  { id: 'reload', sel: '.tc-reload', label: 'Nachladen' },
  { id: 'jump', sel: '.tc-jump', label: 'Springen / Überklettern' },
  { id: 'crouch', sel: '.tc-crouch', label: 'Ducken' },
  { id: 'grenade', sel: '.tc-grenade', label: 'Granate' },
  { id: 'tactical', sel: '.tc-tactical', label: 'Taktische Granate', auto: 'tactical', def: { x: 60.5, y: 76, s: 48 } },
  { id: 'melee', sel: '.tc-melee', label: 'Messer' },
  { id: 'swap', sel: '.tc-swap', label: 'Waffe wechseln' },
  { id: 'leanL', sel: '.tc-lean-l', label: 'Links lehnen', optional: true, def: { x: 4.8, y: 56, s: 46 } },
  { id: 'leanR', sel: '.tc-lean-r', label: 'Rechts lehnen', optional: true, def: { x: 11, y: 56, s: 46 } },
  { id: 'light', sel: '.tc-light', label: 'Lampe', auto: 'light', def: { x: 63, y: 42, s: 46 } },
  { id: 'prone', sel: '.tc-prone', label: 'Hinlegen', def: { x: 94.2, y: 70, s: 46 } },
  { id: 'plate', sel: '.tc-plate', label: 'Panzerplatte', auto: 'armor', def: { x: 54, y: 89, s: 46 } },
  { id: 'gadget', sel: '.tc-gadget', label: 'Klassen-Ausrüstung', auto: 'gadget', def: { x: 54, y: 75, s: 46 } },
  { id: 'streaks', sel: '.tc-streaks', label: 'Serienprämien', kind: 'group' },
  { id: 'score', sel: '.tc-score', label: 'Punktetabelle' },
  { id: 'pause', sel: '.tc-pause', label: 'Pause' },
]);
export const TOUCH_BUTTON_IDS = Object.freeze(TOUCH_BUTTONS.map((b) => b.id));

/** Seitenverhältnis-Klassen, je Klasse ein eigenes Layout. */
export const TOUCH_ASPECTS = Object.freeze(['hoch', '4:3', '16:10', '16:9', '20:9']);
export function aspectBucket(w, h) {
  const a = w / Math.max(1, h);
  if (a < 1) return 'hoch';
  if (a < 1.45) return '4:3';
  if (a < 1.7) return '16:10';
  if (a < 1.95) return '16:9';
  return '20:9';
}

/**
 * Vorlagen. buttons: Lage je Knopf (Mitte in %, s = Größenfaktor, o = Deckkraft, h = verborgen).
 * mirror: alle Lagen (auch die aus game.css) waagerecht spiegeln. stick.side: Joystick-Hälfte.
 */
export const TOUCH_PRESETS = deepFreeze({
  standard: { label: 'Standard', buttons: {}, stick: { side: 'left' } },
  klaue: {
    label: 'Klaue (3 Finger)',
    // Zeigefinger oben: links feuern, rechts zielen/springen; Daumen bleibt am Feuerknopf und am Stick
    buttons: {
      fireL: { x: 8, y: 24, s: 1.1 }, ads: { x: 90.5, y: 30 }, jump: { x: 80.6, y: 22.5 }, crouch: { x: 94.6, y: 52 },
      streaks: { x: 64.5, y: 9.5 }, adsfire: { h: true }, reload: { x: 78.8, y: 45 },
    },
    stick: { side: 'left' },
  },
  links: { label: 'Linkshänder', buttons: {}, mirror: true, stick: { side: 'right' } },
});
export const TOUCH_PRESET_IDS = Object.freeze(Object.keys(TOUCH_PRESETS));

export const DEFAULT_TOUCH_LAYOUT = deepFreeze({ preset: 'standard', custom: {}, stick: { fixed: false } });

const clampN = (v, a, b, d) => (Number.isFinite(+v) ? Math.min(b, Math.max(a, +v)) : d);
const round = (v, k = 100) => Math.round(v * k) / k;

/** Ein Layout-Eintrag { x, y, s, o, h } bereinigen (fehlende Felder bleiben weg). */
export function sanitizeTouchEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const out = {};
  if (e.x != null && Number.isFinite(+e.x)) out.x = round(clampN(e.x, 0, 100, 50));
  if (e.y != null && Number.isFinite(+e.y)) out.y = round(clampN(e.y, 0, 100, 50));
  if (e.s != null && Number.isFinite(+e.s)) out.s = round(clampN(e.s, 0.6, 1.8, 1));
  if (e.o != null && Number.isFinite(+e.o)) out.o = round(clampN(e.o, 0.15, 1, 1));
  if (typeof e.h === 'boolean') out.h = e.h;
  return Object.keys(out).length ? out : null;
}

/** Gespeichertes touchLayout bereinigen (für settings.js). Unbrauchbar → undefined. */
export function sanitizeTouchLayout(v) {
  if (v === null) return JSON.parse(JSON.stringify(DEFAULT_TOUCH_LAYOUT));
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out = { preset: TOUCH_PRESETS[v.preset] ? v.preset : 'standard', custom: {}, stick: { fixed: !!(v.stick && v.stick.fixed) } };
  if (v.stick && (v.stick.side === 'left' || v.stick.side === 'right')) out.stick.side = v.stick.side;
  const custom = v.custom && typeof v.custom === 'object' ? v.custom : {};
  for (const asp of TOUCH_ASPECTS) {
    const src = custom[asp];
    if (!src || typeof src !== 'object') continue;
    const m = {};
    for (const id of TOUCH_BUTTON_IDS) { const e = sanitizeTouchEntry(src[id]); if (e) m[id] = e; }
    if (Object.keys(m).length) out.custom[asp] = m;
  }
  return out;
}

/**
 * Wirksames Layout für eine Seitenverhältnis-Klasse: Vorlage + eigene Änderungen dieser Klasse (fehlen sie, die der
 * nächstgelegenen Querformat-Klasse). → { preset, aspect, mirror, stick: { side, fixed }, buttons: { id: {x?,y?,s?,o?,h?} } }
 */
export function resolveTouchLayout(layout, aspect = '20:9') {
  const L = sanitizeTouchLayout(layout) || sanitizeTouchLayout(null);
  const P = TOUCH_PRESETS[L.preset] || TOUCH_PRESETS.standard;
  const buttons = {};
  for (const [id, e] of Object.entries(P.buttons || {})) buttons[id] = { ...e };
  let own = L.custom[aspect];
  if (!own && aspect !== 'hoch') {
    const i = TOUCH_ASPECTS.indexOf(aspect);
    let best = null, bd = 99;
    for (const [k, m] of Object.entries(L.custom)) {
      if (k === 'hoch') continue;
      const d = Math.abs(TOUCH_ASPECTS.indexOf(k) - i);
      if (d < bd) { bd = d; best = m; }
    }
    own = best;
  }
  if (own) for (const [id, e] of Object.entries(own)) buttons[id] = { ...(buttons[id] || {}), ...e };
  return {
    preset: L.preset, aspect, mirror: !!P.mirror,
    stick: { side: L.stick.side || (P.stick && P.stick.side) || 'left', fixed: !!L.stick.fixed },
    buttons,
  };
}

/** Einen Knopf im Layout ändern (Editor): gibt ein neues touchLayout zurück (Klasse `aspect`, Eintrag gemischt). */
export function setTouchEntry(layout, aspect, id, entry) {
  const L = sanitizeTouchLayout(layout) || sanitizeTouchLayout(null);
  if (!TOUCH_BUTTON_IDS.includes(id) || !TOUCH_ASPECTS.includes(aspect)) return L;
  const m = { ...(L.custom[aspect] || {}) };
  if (entry == null) delete m[id];
  else { const e = sanitizeTouchEntry({ ...(m[id] || {}), ...entry }); if (e) m[id] = e; else delete m[id]; }
  if (Object.keys(m).length) L.custom[aspect] = m; else delete L.custom[aspect];
  return L;
}

/* ------------------------------------------------------------------ Hilfen */

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/** Tastaturlayout des Browsers (Chromium: navigator.keyboard.getLayoutMap) oder null. */
export async function loadKeyboardLayout() {
  try {
    const kb = typeof navigator !== 'undefined' ? navigator.keyboard : null;
    if (kb && typeof kb.getLayoutMap === 'function') return await kb.getLayoutMap();
  } catch { /* nicht erlaubt (z. B. in iframes) */ }
  return null;
}
