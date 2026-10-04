// NULLPUNKT — Steuerungsübersicht (Tastatur & Maus · Touch mit Schema · Gamepad), gleiche Belegung wie input.js.

import { esc } from './dom.js';
import { ICON } from './icons.js';

const KEYS = [
  ['Bewegen', ['W', 'A', 'S', 'D']],
  ['Umsehen', ['Maus']],
  ['Feuern', ['Linke Maustaste']],
  ['Zielen (Anlegen)', ['Rechte Maustaste']],
  ['Sprinten', ['Umschalt']],
  ['Springen', ['Leertaste']],
  ['Ducken · im Sprint Rutschen', ['C', 'Strg']],
  ['Nachladen', ['R']],
  ['Waffe wechseln', ['1', '2', 'Mausrad']],
  ['Messer', ['V', 'Maustaste 4']],
  ['Granate (halten = vorkochen)', ['G', 'Q']],
  ['Aufklärer · Präzisionsschlag · Wachgeschütz', ['3', '4', '5']],
  ['Interagieren (Parcours)', ['F', 'E']],
  ['Punktetabelle', ['Tab']],
  ['Pause', ['Esc']],
];

const PAD = [
  ['Bewegen / Umsehen', ['Linker Stick', 'Rechter Stick']],
  ['Feuern / Zielen', ['RT', 'LT']],
  ['Springen', ['A']],
  ['Ducken · Rutschen', ['B']],
  ['Nachladen', ['X']],
  ['Waffe wechseln', ['Y']],
  ['Granate', ['LB']],
  ['Messer', ['RB', 'R3']],
  ['Sprinten', ['L3']],
  ['Aufklärer · Schlag · Geschütz', ['▲', '◀', '▶']],
  ['Punktetabelle / Pause', ['View', 'Menü']],
  ['Menüs: bewegen · wählen · zurück', ['Steuerkreuz', 'A', 'B']],
];

// Positionen wie in game.css (Querformat), in % der Bildschirmbreite/-höhe
const TOUCH = [
  ['tc-d-stick', 15, 76, 'Joystick', 'überall links aufsetzen · ganz nach oben = Sprint sperren'],
  ['tc-d-look', 60, 36, 'Umsehen', 'rechte Hälfte ziehen'],
  ['tc-d-fire', 88, 66, 'Feuern', 'halten und ziehen = zielen'],
  ['tc-d-small', 8, 40, 'Feuern', 'links'],
  ['tc-d-ads', 79, 62, 'Zielen', ''],
  ['tc-d-small', 78, 41, 'Nachladen', ''],
  ['tc-d-small', 95, 47, 'Springen', ''],
  ['tc-d-small', 95, 89, 'Ducken', 'im Sprint: Rutschen'],
  ['tc-d-small', 71, 84, 'Granate', ''],
  ['tc-d-small', 79, 90, 'Messer', ''],
  ['tc-d-pill', 50, 92, 'Waffe wechseln', ''],
  ['tc-d-small', 89, 19, 'Serien', 'Ring = Fortschritt'],
  ['tc-d-small', 95, 8, 'Pause', ''],
  ['tc-d-small', 89, 8, 'Tabelle', ''],
  ['tc-d-map', 8, 15, 'Karte', ''],
];

const kbd = (list) => list.map((k) => `<kbd>${esc(k)}</kbd>`).join('<i>/</i>');

export function controlsHtml(initial = 'keys') {
  const tabs = [['keys', 'Tastatur & Maus', ICON.keyboard], ['touch', 'Touch', ICON.touch], ['pad', 'Gamepad', ICON.pad]];
  return `
    <div class="ch">
      <div class="m-tabs ch-tabs" role="tablist">${tabs.map(([id, l, ic]) => `<button type="button" class="m-tab" role="tab" data-ch="${id}" aria-selected="${id === initial}">${ic}<span>${l}</span></button>`).join('')}</div>
      <div class="ch-body m-scroll" data-scrollable>
        <div class="ch-pane" data-pane="keys"${initial === 'keys' ? '' : ' hidden'}><table class="ch-table">${KEYS.map(([a, k]) => `<tr><td>${esc(a)}</td><td>${kbd(k)}</td></tr>`).join('')}</table></div>
        <div class="ch-pane" data-pane="touch"${initial === 'touch' ? '' : ' hidden'}>
          <div class="ch-phone" aria-hidden="true">${TOUCH.map(([cls, x, y, l, s]) => `<div class="tc-d ${cls}" style="left:${x}%;top:${y}%"><b>${esc(l)}</b>${s ? `<small>${esc(s)}</small>` : ''}</div>`).join('')}</div>
          <ul class="ch-list">
            <li><b>Links</b> bewegst du mit dem schwebenden Joystick. Schiebst du ihn ganz nach oben, sperrt der Sprint.</li>
            <li><b>Rechts</b> ziehst du zum Umsehen. Der große Feuerknopf zielt mit, während du ihn ziehst.</li>
            <li><b>Serienprämien</b> oben rechts: Der Ring füllt sich mit jedem Abschuss.</li>
            <li>Zielhilfe, automatisches Feuern und Touch-Empfindlichkeit findest du in den Einstellungen.</li>
          </ul>
        </div>
        <div class="ch-pane" data-pane="pad"${initial === 'pad' ? '' : ' hidden'}><table class="ch-table">${PAD.map(([a, k]) => `<tr><td>${esc(a)}</td><td>${kbd(k)}</td></tr>`).join('')}</table></div>
      </div>
    </div>`;
}

/** Reiterwechsel im eingebauten HTML verdrahten. */
export function bindControls(root) {
  root.querySelector('.ch-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ch]');
    if (!b) return;
    root.querySelectorAll('[data-ch]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    root.querySelectorAll('.ch-pane').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.ch; });
  });
}
