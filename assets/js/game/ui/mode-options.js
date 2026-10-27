// NULLPUNKT — Regler für Modus-Einstellungen (B6, 26.10.): MODES[id].options als Segment-Knöpfe, ein Baustein für
// Lobby (ui/lobby.js, Einsatz-Reiter) und Raum-Menü (ui/net-menus.js, Host). Knöpfe tragen data-mopt (Option) und
// data-v (Wert); die Aufrufer setzen den Wert (Lobby: settings.modeOptions, Raum: room.settings.modeOpts).
// Optionen mit limit (z. B. 'scoreLimit') lässt das Raum-Menü weg – dort gibt es den allgemeinen Regler schon.

import { esc } from './dom.js';
import { modeOptionValues, modeOptionText } from '../../shared/modes.data.js';

/** Sichtbare Optionen eines Modus (skipLimits: ohne die allgemeinen Limits). */
export function modeOptionList(mode, { skipLimits = false } = {}) {
  return (mode && Array.isArray(mode.options) ? mode.options : []).filter((o) => !(skipLimits && o.limit));
}

/**
 * HTML der Regler. style 'lobby' (Überschrift h2.m-h2, wie die übrigen Lobby-Optionen) | 'room' (nr-field/nr-lab, mit
 * data-fk für den Fokuserhalt im Raum-Menü).
 */
export function modeOptionsHtml(mode, raw, { style = 'lobby', skipLimits = false } = {}) {
  const list = modeOptionList(mode, { skipLimits });
  if (!list.length) return '';
  const vals = modeOptionValues(mode.id, raw);
  const room = style === 'room';
  return list.map((o) => {
    const btns = o.values.map((v) => {
      const sv = esc(String(v));
      return `<button type="button" role="radio" data-mopt="${esc(o.id)}" data-v="${sv}"${room ? ` data-fk="mopt-${esc(o.id)}-${sv}"` : ''} aria-checked="${v === vals[o.id]}"${v === o.def ? ' title="Standard"' : ''}>${esc(modeOptionText(o, v))}</button>`;
    }).join('');
    const head = room ? `<h3 class="nr-lab">${esc(o.label)}</h3>` : `<h2 class="m-h2">${esc(o.label)}</h2>`;
    const hint = o.hint ? `<p class="lb-note">${esc(o.hint)}</p>` : '';
    return `<div class="${room ? 'nr-field' : 'lb-mopt'}" data-mopt-box="${esc(o.id)}">${head}<div class="m-seg${room ? ' nr-seg' : ''}" role="radiogroup" aria-label="${esc(o.label)}">${btns}</div>${hint}</div>`;
  }).join('');
}

/** Lesbare Zeilen [Bezeichnung, Wert] (Raum-Ansicht der Mitspieler). */
export function modeOptionsSummary(mode, raw, { skipLimits = false } = {}) {
  const vals = modeOptionValues(mode && mode.id, raw);
  return modeOptionList(mode, { skipLimits }).map((o) => [o.label, modeOptionText(o, vals[o.id])]);
}
