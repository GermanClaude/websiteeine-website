// NULLPUNKT — Steuerungsübersicht (Tastatur & Maus · Touch mit Schema · Gamepad). Tastatur und Gamepad kommen aus
// der aktuellen Belegung (input.bindings, shared/bindings.data.js) – eigene Tasten erscheinen hier sofort.
// „Belegung ändern“ führt in Einstellungen → Belegung (bzw. zum Touch-Layout-Editor).

import { esc } from './dom.js';
import { ICON } from './icons.js';
import { ACTION_DEFS, ACTION_GROUPS, resolveBindings } from '../../shared/bindings.data.js';
import { keyHtml } from './settings/keys.js';

// Positionen wie in game.css (Querformat), in % der Bildschirmbreite/-höhe → nummerierte Marken + Legende
const TOUCH = [
  [15, 76, 'Joystick', 'Überall links aufsetzen. Ganz nach oben schieben sperrt den Sprint.', 'big'],
  [60, 40, 'Umsehen', 'Auf der rechten Hälfte ziehen. Optional Gyro (Einstellungen → Steuerung).', 'zone'],
  [88, 66, 'Feuern', 'Halten. Gleichzeitig ziehen zielt mit.', 'fire'],
  [8, 40, 'Feuern links', 'Zweiter Feuerknopf für den linken Daumen.', ''],
  [79, 62, 'Zielen', 'Umschalter für das Anlegen.', ''],
  [78, 41, 'Nachladen', '', ''],
  [95, 47, 'Springen', 'Vor einer Kante: überklettern.', ''],
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

function tableHtml(G, dev) {
  const res = (G && G.input && G.input.bindings) || resolveBindings(G && G.settings ? G.settings.get('bindings') : null);
  const rows = [];
  if (dev === 'kb') rows.push(['Umsehen', kbd(['Maus'])]);
  else rows.push(['Bewegen / Umsehen', kbd(['Linker Stick', 'Rechter Stick'])]);
  let group = null;
  for (const a of ACTION_DEFS) {
    if (dev === 'pad' && a.id.startsWith('move_')) continue;
    const list = res[dev][a.id] || [];
    if (!list.length) continue;
    if (a.group !== group) { group = a.group; rows.push([null, ACTION_GROUPS[group]]); }
    rows.push([a.label, list.map((c) => keyHtml(G, c)).join('<i>/</i>')]);
  }
  if (dev === 'pad') rows.push([null, 'Menüs'], ['Bewegen · wählen · zurück · Reiter', kbd(['Steuerkreuz', 'A', 'B', 'LB/RB'])]);
  return `<table class="ch-table">${rows.map(([l, k]) => (l == null ? `<tr class="ch-grp"><td colspan="2">${esc(k)}</td></tr>` : `<tr><td>${esc(l)}</td><td>${k}</td></tr>`)).join('')}</table>`;
}

/** HTML der Übersicht. initial: 'keys' | 'touch' | 'pad'; G: für die aktuelle Belegung. */
export function controlsHtml(initial = 'keys', G = null) {
  const tabs = [['keys', 'Tastatur & Maus', ICON.keyboard], ['touch', 'Touch', ICON.touch], ['pad', 'Gamepad', ICON.pad]];
  return `
    <div class="ch">
      <div class="m-tabs ch-tabs" role="tablist">${tabs.map(([id, l, ic]) => `<button type="button" class="m-tab" role="tab" data-ch="${id}" aria-selected="${id === initial}">${ic}<span>${l}</span></button>`).join('')}</div>
      <div class="ch-body m-scroll" data-scrollable>
        <div class="ch-pane" data-pane="keys"${initial === 'keys' ? '' : ' hidden'}>${tableHtml(G, 'kb')}
          <div class="ch-more"><button type="button" class="m-btn" data-ch-edit="kb">${ICON.keyboard}<span>Belegung ändern</span></button><small>Halten oder Umschalten, Empfindlichkeit je Zoomstufe: Einstellungen → Steuerung.</small></div></div>
        <div class="ch-pane" data-pane="touch"${initial === 'touch' ? '' : ' hidden'}>
          <div class="ch-touch">
            <div class="ch-phone" aria-hidden="true">${TOUCH.map(([x, y, , , kind], i) => `<span class="tc-d ${kind ? `tc-d-${kind}` : ''}" style="left:${x}%;top:${y}%">${i + 1}</span>`).join('')}</div>
            <ol class="ch-legend">${TOUCH.map(([, , l, d]) => `<li><b>${esc(l)}</b>${d ? ` <span>${esc(d)}</span>` : ''}</li>`).join('')}</ol>
          </div>
          <p class="ch-note">Zusätzliche Knöpfe (Lehnen, Zielen + Feuern), Lage, Größe und Deckkraft jedes Knopfs: Touch-Layout-Editor.</p>
          <div class="ch-more"><button type="button" class="m-btn" data-ch-edit="touch">${ICON.layout}<span>Touch-Layout bearbeiten</span></button></div>
        </div>
        <div class="ch-pane" data-pane="pad"${initial === 'pad' ? '' : ' hidden'}>${tableHtml(G, 'pad')}
          <div class="ch-more"><button type="button" class="m-btn" data-ch-edit="pad">${ICON.pad}<span>Belegung ändern</span></button><small>Kurve, Totzonen und Vibration: Einstellungen → Steuerung → Controller.</small></div></div>
      </div>
    </div>`;
}

/** Reiterwechsel verdrahten; onEdit(device) für „Belegung ändern“ / „Touch-Layout bearbeiten“. */
export function bindControls(root, onEdit = null) {
  root.querySelector('.ch-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ch]');
    if (!b) return;
    root.querySelectorAll('[data-ch]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    root.querySelectorAll('.ch-pane').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.ch; });
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ch-edit]');
    if (b && onEdit) onEdit(b.dataset.chEdit);
  });
}
