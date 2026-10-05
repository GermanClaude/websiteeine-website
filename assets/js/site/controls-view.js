// §07 Steuerung: Belegung. Reiter Touch · Tastatur & Maus · Gamepad. Tastenprobe nur bei Fokus,
// Gamepad-Abfrage nur, solange der Reiter sichtbar und das Dokument im Vordergrund ist.
import { h, $, tabs } from './dom.js';
import { loop } from './loop.js';
import { pointerCoarse, reduced } from './motion.js';

/*
 * Touch-Belegung wie im Spiel: Mitte jedes Knopfs in Prozent der Bildfläche im Querformat (915 × 412), gemessen an
 * der echten Oberfläche (input.js + game.css .tc-*, Werkzeug tools/out/fix-site/touchmeasure.mjs). Ändert sich die
 * Touch-Oberfläche, hier nachziehen. [id, x, y, Wort, Erklärung, Form, Gruppe]
 */
export const TOUCH = [
  ['move', 21.7, 63, 'BEWEGEN', 'Joystick. Er erscheint, wo dein linker Daumen landet; ganz nach oben geschoben sperrt er den Sprint.', 'ring'],
  ['fireL', 7.3, 39.4, 'FEUER', 'Halten feuert. Links bleibt der rechte Daumen frei zum Zielen.'],
  ['look', 60, 30, 'UMSEHEN', 'Wische irgendwo auf der rechten Hälfte, um dich umzusehen.', 'area'],
  ['fire', 88.4, 67.7, 'FEUER', 'Halten feuert. Ziehen dreht dabei die Sicht.', 'big'],
  ['ads', 78.9, 63.6, 'ZIELEN', 'Tippen legt an, erneutes Tippen nimmt die Waffe herunter.'],
  ['reload', 78.8, 41.8, 'NACHLADEN', 'Lädt nach. Leuchtet, wenn das Magazin fast leer ist.'],
  ['jump', 94.6, 46.8, 'SPRINGEN', 'Über niedrige Deckung und Kanten.'],
  ['crouch', 94.6, 88.8, 'DUCKEN', 'Kleiner werden. Im Sprint: rutschen.'],
  ['grenade', 71.5, 84.8, 'GRANATE', 'Halten kocht vor, loslassen wirft in Blickrichtung.'],
  ['melee', 79.1, 89.5, 'MESSER', 'Nahkampf mit dem Kampfmesser.'],
  ['swap', 50, 91.7, 'WAFFE', 'Wechselt zwischen Primär- und Zweitwaffe; zeigt die andere Waffe.'],
  ['streak1', 84.2, 21.2, '4', 'Aufklärer nach 4 Abschüssen ohne Tod. Leuchtet golden, sobald bereit; antippen setzt ihn ein.', 'sm', 'streak'],
  ['streak2', 89.8, 21.2, '6', 'Präzisionsschlag nach 6 Abschüssen ohne Tod. Antippen öffnet die Zielkarte.', 'sm', 'streak'],
  ['streak3', 95.4, 21.2, '8', 'Wachgeschütz nach 8 Abschüssen ohne Tod. Leuchtet golden, sobald bereit.', 'sm', 'streak'],
  ['score', 89.9, 8, 'PUNKTE', 'Punktetabelle ein- und ausblenden.', 'sm'],
  ['pause', 95.5, 8, 'PAUSE', 'Pause, Einstellungen und Match verlassen.', 'sm'],
  ['map', 6.7, 14.4, 'KARTE', 'Minikarte: Verbündete, Ziele, feuernde Gegner.'],
];
/** Wortleiste unter schmalen Telefonbildern: ein Eintrag je Gruppe. */
const GROUP_WORD = { streak: 'SERIEN' };
const GROUP_TEXT = { streak: 'Serienprämien: Aufklärer nach 4, Präzisionsschlag nach 6, Wachgeschütz nach 8 Abschüssen ohne Tod. Leuchten golden, sobald bereit.' };

/*
 * Tastatur & Maus wie engine/input.js (KEY_ACTIONS, MOVE_KEYS, MOUSE_ACTIONS; Mausrad = Waffe wechseln) und die
 * Spielhilfe (ui/controls-help.js). [Taste, Aktion, Echo, KeyboardEvent.code[], Maustasten[]]
 * Geprüft mit tools/out/fix-site/bindings.mjs.
 */
export const KEYS = [
  ['W A S D', 'Bewegen', 'BEWEGEN', ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']],
  ['Maus', 'Umsehen', 'UMSEHEN', []],
  ['LMT', 'Feuern', 'FEUERN', [], [0]],
  ['RMT', 'Zielen (halten)', 'ZIELEN', [], [2]],
  ['R', 'Nachladen', 'NACHLADEN', ['KeyR']],
  ['Leertaste', 'Springen', 'SPRINGEN', ['Space']],
  ['C', 'Ducken, im Sprint rutschen', 'DUCKEN', ['KeyC']],
  ['Umschalt', 'Sprinten, im Zielfernrohr Atem anhalten', 'SPRINTEN', ['ShiftLeft', 'ShiftRight']],
  ['V / Maus 4', 'Messer', 'MESSER', ['KeyV'], [3]],
  ['G / Q', 'Granate (halten: vorkochen)', 'GRANATE', ['KeyG', 'KeyQ']],
  ['1 / 2 / Mausrad / Maus 5', 'Waffe wechseln', 'WAFFE WECHSELN', ['Digit1', 'Digit2'], [4]],
  ['3 / 4 / 5', 'Serienprämien', 'SERIENPRÄMIEN', ['Digit3', 'Digit4', 'Digit5']],
  ['F / E', 'Interagieren (Parcours im Schießstand)', 'INTERAGIEREN', ['KeyF', 'KeyE']],
  ['Tab', 'Punktetabelle', 'PUNKTETABELLE', ['Tab']],
  ['Esc', 'Pause', 'PAUSE', ['Escape']],
];
const KEY_NAMES = {
  Space: 'LEERTASTE', ShiftLeft: 'UMSCHALT', ShiftRight: 'UMSCHALT', ControlLeft: 'STRG', ControlRight: 'STRG',
  AltLeft: 'ALT', AltRight: 'ALT GR', ArrowUp: 'PFEIL HOCH', ArrowDown: 'PFEIL RUNTER', ArrowLeft: 'PFEIL LINKS', ArrowRight: 'PFEIL RECHTS',
  Enter: 'EINGABE', NumpadEnter: 'EINGABE', Backspace: 'RÜCKTASTE', CapsLock: 'FESTSTELLTASTE', MetaLeft: 'SYSTEMTASTE', MetaRight: 'SYSTEMTASTE', ContextMenu: 'MENÜTASTE',
};
const MOUSE_NAMES = ['LMT', 'MITTELTASTE', 'RMT', 'MAUS 4', 'MAUS 5'];

/* Gamepad (Standard-Mapping) wie engine/input.js PAD_ACTIONS (+ Trigger und Sticks): [Index, Taste, Aktion]. */
export const PAD = [
  [7, 'RT', 'Feuern'], [6, 'LT', 'Zielen'], [0, 'A', 'Springen'], [1, 'B', 'Ducken, im Sprint rutschen'], [2, 'X', 'Nachladen'],
  [3, 'Y', 'Waffe wechseln'], [4, 'LB', 'Granate (halten: vorkochen)'], [5, 'RB', 'Messer'],
  [10, 'L-Stick', 'Bewegen · drücken: Sprinten, im Zielfernrohr Atem anhalten'], [11, 'R-Stick', 'Umsehen · drücken: Messer'],
  [[12, 14, 15], 'Steuerkreuz ▲ ◀ ▶', 'Serienprämien'], [8, 'Ansicht', 'Punktetabelle'], [9, 'Menü', 'Pause'],
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
  const NAME = { fireL: 'FEUER LINKS', fire: 'FEUER RECHTS', streak1: '4 · AUFKLÄRER', streak2: '6 · PRÄZISIONSSCHLAG', streak3: '8 · WACHGESCHÜTZ' };
  // Ein Eintrag (Telefon) oder eine ganze Gruppe (Wortleiste, z. B. alle drei Serienprämien) auswählen
  const choose = (item, group) => {
    for (const b of btns) b.el.setAttribute('aria-pressed', String(group ? b.item[6] === group : b.item === item));
    explain.textContent = group ? `${GROUP_WORD[group]} · ${GROUP_TEXT[group]}` : `${NAME[item[0]] || item[3]} · ${item[4]}`;
    snd?.ui('click');
  };
  const listed = new Set();
  for (const item of TOUCH) {
    const [id, x, y, word, , shape, group] = item;
    if (shape === 'ring') phone.append(h('span.ring', { style: { left: `${x}%`, top: `${y}%`, width: '17%', 'aspect-ratio': '1' }, 'aria-hidden': 'true' }));
    if (shape === 'area') phone.append(h('span.area', { style: { left: '50%', top: '4%', right: '3%', bottom: '4%' }, 'aria-hidden': 'true' }));
    const cls = shape === 'big' || shape === 'sm' ? `.${shape}` : '';
    const inPhone = h(`button.tp${cls}`, { type: 'button', 'aria-pressed': 'false', 'data-id': id, 'data-group': group || null, 'aria-label': NAME[id] || null, style: { left: `${x}%`, top: `${y}%` } }, word);
    inPhone.addEventListener('click', () => choose(item));
    btns.push({ el: inPhone, item });
    phone.append(inPhone);
    if (group && listed.has(group)) continue;
    const inList = h('button.tl', { type: 'button', 'aria-pressed': 'false', 'data-id': group || id }, group ? GROUP_WORD[group] : (NAME[id] || word));
    inList.addEventListener('click', () => choose(item, group));
    btns.push({ el: inList, item });
    legend.append(inList);
    if (group) listed.add(group);
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
  // Wörter am Rand nach innen rücken, damit keines über den Telefonrahmen ragt, und sich berührende Wörter
  // auseinanderschieben (die Knöpfe im Spiel sind Symbole und liegen enger als ihre Wörter).
  const clampLabels = () => {
    const P = phone.getBoundingClientRect();
    if (!P.width) return;
    const pad = Math.max(8, P.height * 0.06);
    const items = [];
    const range = document.createRange();
    for (const el of phone.querySelectorAll('.tp')) {
      el.style.removeProperty('--dx');
      el.style.removeProperty('--dy');
      if (!el.getClientRects().length) continue;
      // Gemessen wird das Wort selbst, nicht die (größere) Trefferfläche
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      items.push({ el, l: r.left, r: r.right, t: r.top, b: r.bottom, dx: 0, dy: 0 });
    }
    const inside = (it) => {
      const dx = Math.min(0, P.right - pad - (it.r + it.dx)) + Math.max(0, P.left + pad - (it.l + it.dx));
      const dy = Math.min(0, P.bottom - pad - (it.b + it.dy)) + Math.max(0, P.top + pad - (it.t + it.dy));
      it.dx += dx;
      it.dy += dy;
    };
    items.forEach(inside);
    // Paarweise trennen (halb und halb; der Rahmen hat Vorrang)
    const gap = Math.max(12, 1.2 * (parseFloat(getComputedStyle(phone.querySelector('.tp') || phone).fontSize) || 14));
    for (let pass = 0; pass < 6; pass++) {
      let moved = false;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i]; const c = items[j];
          const ox = Math.min(a.r + a.dx, c.r + c.dx) - Math.max(a.l + a.dx, c.l + c.dx) + gap;
          const oy = Math.min(a.b + a.dy, c.b + c.dy) - Math.max(a.t + a.dy, c.t + c.dy) + gap;
          if (ox <= gap || oy <= gap) continue;
          // Nebeneinander liegende Wörter waagerecht trennen, übereinander liegende senkrecht
          const sideBySide = Math.abs((a.l + a.r) / 2 + a.dx - (c.l + c.r) / 2 - c.dx) / (a.r - a.l + c.r - c.l)
            >= Math.abs((a.t + a.b) / 2 + a.dy - (c.t + c.b) / 2 - c.dy) / (a.b - a.t + c.b - c.t);
          if (!sideBySide) {
            const [hi, lo] = (a.t + a.dy) <= (c.t + c.dy) ? [a, c] : [c, a];
            hi.dy -= oy / 2; lo.dy += oy / 2;
            inside(hi); inside(lo);
          } else {
            const [lf, rt] = (a.l + a.dx) <= (c.l + c.dx) ? [a, c] : [c, a];
            lf.dx -= ox / 2; rt.dx += ox / 2;
            inside(lf); inside(rt);
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
    for (const it of items) {
      if (it.dx) it.el.style.setProperty('--dx', `${it.dx.toFixed(1)}px`);
      if (it.dy) it.el.style.setProperty('--dy', `${it.dy.toFixed(1)}px`);
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
