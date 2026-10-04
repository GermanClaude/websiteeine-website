// §07 Steuerung: Belegung. Reiter Touch · Tastatur & Maus · Gamepad. Tastenprobe nur bei Fokus,
// Gamepad-Abfrage nur, solange der Reiter sichtbar und das Dokument im Vordergrund ist.
import { h, $, tabs } from './dom.js';
import { loop } from './loop.js';
import { pointerCoarse, reduced } from './motion.js';

/* Touch-Belegung: Position im Querformat (Prozent, Mitte), Wort, Erklärung. Nach game.css (.tc-*). */
const TOUCH = [
  ['move', 20, 74, 'BEWEGEN', 'Joystick bis zum Rand schieben: Dauersprint. Er erscheint, wo dein linker Daumen landet.', 'ring'],
  ['fireL', 8, 40, 'FEUER', 'Halten feuert. Links und rechts erreichbar; links bleibt der rechte Daumen frei zum Zielen.'],
  ['look', 60, 30, 'UMSEHEN', 'Wische irgendwo auf der rechten Hälfte, um dich umzusehen.', 'area'],
  ['fire', 87, 70, 'FEUER', 'Halten feuert. Links und rechts erreichbar; rechts dreht Ziehen dabei die Sicht.', 'big'],
  ['ads', 72, 64, 'ZIELEN', 'Tippen legt an, erneutes Tippen nimmt die Waffe herunter.'],
  ['reload', 72, 44, 'NACHLADEN', 'Lädt nach. Leuchtet, wenn das Magazin fast leer ist.'],
  ['jump', 91, 48, 'SPRINGEN', 'Über niedrige Deckung und Kanten.'],
  ['crouch', 92, 90, 'DUCKEN', 'Kleiner werden. Im Sprint: rutschen.'],
  ['grenade', 58, 87, 'GRANATE', 'Wirft die Granate in Blickrichtung.'],
  ['melee', 73, 92, 'MESSER', 'Nahkampf mit dem Kampfmesser.'],
  ['swap', 44, 95, 'WAFFE', 'Wechselt zwischen Primär- und Zweitwaffe; zeigt die aktive Waffe.'],
  ['streak', 86, 24, 'SERIE', 'Serienprämien. Leuchten golden, sobald sie bereit sind.'],
  ['score', 82, 9, 'PUNKTE', 'Punktestand ein- und ausblenden.'],
  ['pause', 93, 9, 'PAUSE', 'Pause, Einstellungen und Match verlassen.'],
  ['map', 9, 14, 'KARTE', 'Minikarte: Verbündete, Ziele, feuernde Gegner.'],
];

/* Tastatur & Maus: Zeilen in Tabellenreihenfolge, mit Codes (KeyboardEvent.code) und Maustasten. */
const KEYS = [
  ['W A S D', 'Bewegen', 'BEWEGEN', ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']],
  ['Maus', 'Umsehen', 'UMSEHEN', []],
  ['LMT', 'Feuer', 'FEUER', [], [0]],
  ['RMT', 'Zielen (halten)', 'ZIELEN', [], [2]],
  ['R', 'Nachladen', 'NACHLADEN', ['KeyR']],
  ['Leertaste', 'Springen', 'SPRINGEN', ['Space']],
  ['C / Strg', 'Ducken, im Sprint rutschen', 'DUCKEN', ['KeyC', 'ControlLeft', 'ControlRight']],
  ['Umschalt', 'Sprinten', 'SPRINTEN', ['ShiftLeft', 'ShiftRight']],
  ['V / Maus 4', 'Nahkampf', 'NAHKAMPF', ['KeyV'], [3]],
  ['G / Q', 'Granate', 'GRANATE', ['KeyG', 'KeyQ']],
  ['1 / 2 / Mausrad', 'Waffe wechseln', 'WAFFE WECHSELN', ['Digit1', 'Digit2', 'Numpad1', 'Numpad2'], [4]],
  ['3 / 4 / 5', 'Serienprämien', 'SERIENPRÄMIEN', ['Digit3', 'Digit4', 'Digit5', 'Numpad3', 'Numpad4', 'Numpad5']],
  ['Tab', 'Punktestand', 'PUNKTESTAND', []],
  ['Esc', 'Pause', 'PAUSE', []],
];
const KEY_NAMES = {
  Space: 'LEERTASTE', ShiftLeft: 'UMSCHALT', ShiftRight: 'UMSCHALT', ControlLeft: 'STRG', ControlRight: 'STRG',
  AltLeft: 'ALT', AltRight: 'ALT GR', ArrowUp: 'PFEIL HOCH', ArrowDown: 'PFEIL RUNTER', ArrowLeft: 'PFEIL LINKS', ArrowRight: 'PFEIL RECHTS',
  Enter: 'EINGABE', Backspace: 'RÜCKTASTE', CapsLock: 'FESTSTELLTASTE', MetaLeft: 'SYSTEMTASTE', MetaRight: 'SYSTEMTASTE', ContextMenu: 'MENÜTASTE',
};
const MOUSE_NAMES = ['LMT', 'MITTELTASTE', 'RMT', 'MAUS 4', 'MAUS 5'];

/* Gamepad (Standard-Mapping): Index → [Taste, Aktion]. Bestätigt mit engine/input.js. */
const PAD = [
  [7, 'RT', 'Feuer'], [6, 'LT', 'Zielen'], [0, 'A', 'Springen'], [1, 'B', 'Ducken'], [2, 'X', 'Nachladen'], [3, 'Y', 'Waffe wechseln'],
  [4, 'LB', 'Granate'], [5, 'RB', 'Nahkampf'], [10, 'L-Stick', 'Bewegen (drücken: Sprint)'], [11, 'R-Stick', 'Umsehen'],
  [[12, 13, 14, 15], 'Steuerkreuz', 'Serienprämien'], [9, 'Start', 'Pause'], [8, 'Ansicht', 'Punktestand'],
];

export async function init(sec, D, ctx = {}) {
  const root = $('#controls-root', sec);
  if (!root) return;
  const S = D.settings;
  const snd = ctx.sound;

  const T = [['touch', 'Touch'], ['keys', 'Tastatur & Maus'], ['pad', 'Gamepad']];
  const list = h('div.tabs.ctl-tabs');
  const panels = {};
  const tabEls = {};
  for (const [id, label] of T) {
    tabEls[id] = h('button.tab', { type: 'button', role: 'tab', id: `ctl-tab-${id}`, 'aria-controls': `ctl-panel-${id}`, 'aria-selected': 'false', tabindex: '-1' }, label);
    list.append(tabEls[id]);
    panels[id] = h('div.tabpanel', { id: `ctl-panel-${id}`, role: 'tabpanel', 'aria-labelledby': `ctl-tab-${id}`, hidden: true });
  }

  /* ------------------------------------------------------------ Touch */
  const explain = h('p.touch-explain', { 'aria-live': 'polite' }, 'Tippe auf ein Wort, um zu sehen, was es tut.');
  const phone = h('div.phone', { role: 'group', 'aria-label': 'Touch-Belegung im Querformat' });
  const legend = h('div.touch-legend', { role: 'group', 'aria-label': 'Touch-Belegung' });
  const btns = [];
  const choose = (item) => {
    for (const b of btns) b.el.setAttribute('aria-pressed', String(b.item === item));
    explain.textContent = `${item[0] === 'fireL' ? 'FEUER LINKS' : item[0] === 'fire' ? 'FEUER RECHTS' : item[3]} · ${item[4]}`;
    snd?.ui('click');
  };
  for (const item of TOUCH) {
    const [id, x, y, word, , shape] = item;
    if (shape === 'ring') phone.append(h('span.ring', { style: { left: `${x}%`, top: `${y}%`, width: '17%', 'aspect-ratio': '1' }, 'aria-hidden': 'true' }));
    if (shape === 'area') phone.append(h('span.area', { style: { left: '50%', top: '4%', right: '3%', bottom: '4%' }, 'aria-hidden': 'true' }));
    const inPhone = h(`button.tp${shape === 'big' ? '.big' : ''}`, { type: 'button', 'aria-pressed': 'false', 'data-id': id, style: { left: `${x}%`, top: `${y}%` } }, word);
    const listWord = id === 'fireL' ? 'FEUER LINKS' : id === 'fire' ? 'FEUER RECHTS' : word;
    const inList = h('button.tl', { type: 'button', 'aria-pressed': 'false', 'data-id': id }, listWord);
    inPhone.addEventListener('click', () => choose(item));
    inList.addEventListener('click', () => choose(item));
    btns.push({ el: inPhone, item }, { el: inList, item });
    phone.append(inPhone);
    legend.append(inList);
  }
  const states = h('p.touch-states');
  const toSettings = h('a', { href: '#einstellungen' }, 'Ändern');
  const paintStates = () => {
    states.replaceChildren(
      h('span', {}, `Zielhilfe: ${S.get('aimAssist') ? 'an' : 'aus'}`),
      h('span', {}, `Automatisch feuern: ${S.get('autoFire') ? 'an' : 'aus'}`),
      toSettings);
  };
  paintStates();
  S.onChange((k) => { if (k === 'aimAssist' || k === 'autoFire') paintStates(); });
  toSettings.addEventListener('click', async (e) => {
    e.preventDefault();
    await ctx.ensure?.('settings');
    const el = document.getElementById('set-aimAssist') || document.getElementById('einstellungen');
    el?.closest('.set-row')?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
    el?.focus?.({ preventScroll: true });
  });
  const touchmap = h('div.touchmap', {}, phone, legend);
  // Schmal: Das Telefon ist nur Bild, die Wortleiste darunter ist die Bedienung (keine doppelten Tab-Stopps).
  const small = (w) => {
    const sm = w < 600;
    for (const b of btns) if (b.el.classList.contains('tp')) { b.el.tabIndex = sm ? -1 : 0; if (sm) b.el.setAttribute('aria-hidden', 'true'); else b.el.removeAttribute('aria-hidden'); }
  };
  // Wörter am Rand nach innen rücken, damit keines über den Telefonrahmen ragt
  const clampLabels = () => {
    const P = phone.getBoundingClientRect();
    if (!P.width) return;
    const pad = Math.max(8, P.height * 0.06);
    for (const el of phone.querySelectorAll('.tp')) {
      el.style.removeProperty('--dx');
      el.style.removeProperty('--dy');
      if (!el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      const dx = Math.min(0, P.right - pad - r.right) + Math.max(0, P.left + pad - r.left);
      const dy = Math.min(0, P.bottom - pad - r.bottom) + Math.max(0, P.top + pad - r.top);
      if (dx) el.style.setProperty('--dx', `${dx.toFixed(1)}px`);
      if (dy) el.style.setProperty('--dy', `${dy.toFixed(1)}px`);
    }
  };
  if ('ResizeObserver' in window) new ResizeObserver(([e]) => { small(e.contentRect.width); requestAnimationFrame(clampLabels); }).observe(touchmap);
  panels.touch.append(
    touchmap,
    explain,
    h('p.touch-hint', {}, 'Im Spiel liegen die Knöpfe genau hier; Größe und Lage folgen den Rändern deines Telefons.'),
    states);

  /* ------------------------------------------------------------ Tastatur & Maus */
  const rows = [];
  const tbody = h('tbody');
  for (const r of KEYS) {
    const tr = h('tr', {}, h('th', { scope: 'row' }, r[0]), h('td', {}, r[1]));
    rows.push({ tr, r });
    tbody.append(tr);
  }
  const table = h('table.keymap', {}, h('caption.sr-only', {}, 'Tastatur und Maus'), tbody);
  const echo = h('p.probe-echo', { 'aria-live': 'polite' });
  const area = h('div.keyprobe-area', { tabindex: '0', role: 'group', 'aria-label': 'Tastenprobe. Drück eine Taste. Esc beendet den Test.' }, table);
  const testBtn = h('button.txt-btn', { type: 'button' }, 'Tasten testen');
  const hint = h('p.mono-s.probe-hint', { hidden: true }, 'Esc beendet den Test.');
  panels.keys.append(h('div.keyprobe', {}, h('div.probe-tools', {}, testBtn, hint), echo, area));
  testBtn.addEventListener('click', () => area.focus());
  let litT = 0;
  // STEUERUNG. antwortet: Steht der gedrückte Buchstabe im Wort, leuchtet er kurz auf.
  const h2 = document.getElementById('h-steuer');
  let keyT = 0;
  const lightLetter = (ch) => {
    if (!h2 || !ch || ch.length !== 1) return;
    const up = ch.toLocaleUpperCase('de-DE');
    const gs = [...h2.querySelectorAll('.vis .g')].filter((g) => g.textContent === up);
    for (const g of h2.querySelectorAll('.g.key-lit')) g.classList.remove('key-lit');
    if (!gs.length) return;
    for (const g of gs) g.classList.add('key-lit');
    clearTimeout(keyT);
    keyT = setTimeout(() => { for (const g of gs) g.classList.remove('key-lit'); }, 700);
  };
  const light = (row, label) => {
    for (const x of rows) x.tr.classList.toggle('lit', x === row);
    echo.textContent = row ? `${label}. ${row.r[2]}.` : `${label} ist frei.`;
    clearTimeout(litT);
    litT = setTimeout(() => { for (const x of rows) x.tr.classList.remove('lit'); }, 900);
  };
  area.addEventListener('focus', () => { area.classList.add('on'); hint.hidden = false; if (!echo.textContent) echo.textContent = 'Drück eine Taste.'; });
  area.addEventListener('blur', () => { area.classList.remove('on'); hint.hidden = true; for (const x of rows) x.tr.classList.remove('lit'); });
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') return;
    if (e.key === 'Escape') { area.blur(); echo.textContent = 'Test beendet.'; return; }
    if (e.ctrlKey && e.code !== 'ControlLeft' && e.code !== 'ControlRight') return; // Tastenkürzel des Browsers bleiben
    if (e.metaKey || e.altKey) return;
    if (e.code === 'Space' || e.key.startsWith('Arrow')) e.preventDefault();
    const row = rows.find((x) => (x.r[3] || []).includes(e.code));
    const label = KEY_NAMES[e.code] || (e.key.length === 1 ? e.key.toLocaleUpperCase('de-DE') : e.key.toLocaleUpperCase('de-DE'));
    light(row, label);
    lightLetter(e.key);
  });
  area.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || document.activeElement !== area) return;
    const row = rows.find((x) => (x.r[4] || []).includes(e.button));
    light(row, MOUSE_NAMES[e.button] || `MAUSTASTE ${e.button + 1}`);
  });
  area.addEventListener('contextmenu', (e) => e.preventDefault());
  area.addEventListener('wheel', (e) => {
    if (document.activeElement !== area) return;
    light(rows.find((x) => x.r[0].includes('Mausrad')), 'MAUSRAD');
  }, { passive: true });

  /* ------------------------------------------------------------ Gamepad */
  const padStatus = h('p.pad-status', { 'aria-live': 'polite' }, 'Kein Gamepad erkannt. Drück eine Taste am Controller.');
  const padRows = [];
  const padBody = h('tbody');
  for (const [idx, key, action] of PAD) {
    const tr = h('tr', {}, h('th', { scope: 'row' }, key), h('td', {}, action));
    padRows.push({ tr, idx: Array.isArray(idx) ? idx : [idx] });
    padBody.append(tr);
  }
  panels.pad.append(padStatus, h('table.keymap.padmap', {}, h('caption.sr-only', {}, 'Gamepad'), padBody));
  let padTask = null;
  const padVisible = () => !panels.pad.hidden && !document.hidden;
  const poll = () => {
    if (!padVisible()) { padTask = null; return false; }
    const pads = navigator.getGamepads?.() || [];
    const pad = [...pads].find(Boolean);
    if (!pad) { padStatus.textContent = 'Kein Gamepad erkannt. Drück eine Taste am Controller.'; for (const r of padRows) r.tr.classList.remove('lit'); return true; }
    const id = pad.id.length > 40 ? `${pad.id.slice(0, 39)}…` : pad.id;
    const txt = `Verbunden: ${id}`;
    if (padStatus.textContent !== txt) padStatus.textContent = txt;
    const ax = pad.axes || [];
    for (const r of padRows) {
      let on = r.idx.some((i) => pad.buttons[i]?.pressed);
      if (r.idx[0] === 10 && Math.hypot(ax[0] || 0, ax[1] || 0) > 0.3) on = true;
      if (r.idx[0] === 11 && Math.hypot(ax[2] || 0, ax[3] || 0) > 0.3) on = true;
      r.tr.classList.toggle('lit', on);
    }
    return true;
  };
  let padSeen = false;
  const startPoll = () => { if (padSeen && !padTask && padVisible()) { padTask = poll; loop.add(poll); } };
  window.addEventListener('gamepadconnected', () => { padSeen = true; startPoll(); });
  window.addEventListener('gamepaddisconnected', () => { padStatus.textContent = 'Kein Gamepad erkannt. Drück eine Taste am Controller.'; });
  document.addEventListener('visibilitychange', startPoll);
  if ([...(navigator.getGamepads?.() || [])].some(Boolean)) padSeen = true;

  /* ------------------------------------------------------------ Einhängen */
  root.replaceChildren(list, panels.touch, panels.keys, panels.pad);
  const tb = tabs(list, {
    label: 'Steuerung',
    onSelect: (tab, user) => {
      const id = tab.id.replace('ctl-tab-', '');
      for (const [pid, p] of Object.entries(panels)) {
        if (pid === id && !reduced()) { p.classList.remove('fade'); void p.offsetWidth; p.classList.add('fade'); }
      }
      if (id === 'pad') startPoll();
      if (user) snd?.ui('click');
    },
  });
  tb.select(tabEls[pointerCoarse() ? 'touch' : 'keys'], false);
}
