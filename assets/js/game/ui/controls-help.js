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
  ['Ducken · im Sprint Rutschen', ['C']],
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

// Positionen wie in game.css (Querformat), in % der Bildschirmbreite/-höhe → nummerierte Marken + Legende
const TOUCH = [
  [15, 76, 'Joystick', 'Überall links aufsetzen. Ganz nach oben schieben sperrt den Sprint.', 'big'],
  [60, 40, 'Umsehen', 'Auf der rechten Hälfte ziehen.', 'zone'],
  [88, 66, 'Feuern', 'Halten. Gleichzeitig ziehen zielt mit.', 'fire'],
  [8, 40, 'Feuern links', 'Zweiter Feuerknopf für den linken Daumen.', ''],
  [79, 62, 'Zielen', 'Umschalter für das Anlegen.', ''],
  [78, 41, 'Nachladen', '', ''],
  [95, 47, 'Springen', '', ''],
  [95, 89, 'Ducken', 'Im Sprint: Rutschen.', ''],
  [71, 84, 'Granate', '', ''],
  [80, 89, 'Messer', '', ''],
  [50, 92, 'Waffe wechseln', '', 'pill'],
  [86, 21, 'Serienprämien', 'Der Ring füllt sich mit jedem Abschuss.', ''],
  [96, 8, 'Pause', '', 'sm'],
  [89, 8, 'Punktetabelle', '', 'sm'],
  [8, 15, 'Minikarte', '', 'big'],
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
          <div class="ch-touch">
            <div class="ch-phone" aria-hidden="true">${TOUCH.map(([x, y, , , kind], i) => `<span class="tc-d ${kind ? `tc-d-${kind}` : ''}" style="left:${x}%;top:${y}%">${i + 1}</span>`).join('')}</div>
            <ol class="ch-legend">${TOUCH.map(([, , l, d]) => `<li><b>${esc(l)}</b>${d ? ` <span>${esc(d)}</span>` : ''}</li>`).join('')}</ol>
          </div>
          <p class="ch-note">Zielhilfe, automatisches Feuern und Touch-Empfindlichkeit findest du in den Einstellungen.</p>
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
