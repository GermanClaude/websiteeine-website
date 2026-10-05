// NULLPUNKT — Tasten- und Controller-Beschriftungen für Menüs und HUD (aus shared/bindings.data.js), Touch-Layout-Helfer.

import { codeLabel, loadKeyboardLayout, aspectBucket, setTouchEntry, sanitizeTouchLayout, TOUCH_ASPECTS } from '../../../shared/bindings.data.js';
import { esc } from '../dom.js';

let kbLayout = null;
let kbAsked = false;
/** Tastaturlayout des Browsers einmal laden (Chromium); bis dahin QWERTZ-Beschriftung. */
export function warmKeyboardLayout() {
  if (kbAsked) return;
  kbAsked = true;
  loadKeyboardLayout().then((m) => { kbLayout = m; });
}

/** 'xbox' | 'ps' – Einstellung padIcons oder am verbundenen Controller erkannt. */
export function padStyle(G) {
  const v = G && G.settings ? G.settings.get('padIcons') : 'auto';
  if (v === 'xbox' || v === 'ps') return v;
  if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
    for (const p of navigator.getGamepads() || []) {
      if (p && p.connected) return /054c|dualsense|dualshock|playstation|wireless controller/i.test(p.id) ? 'ps' : 'xbox';
    }
  }
  return 'xbox';
}

const SIDED = /^(Shift|Control|Meta)(Left|Right)$/;

/** Kurzbeschriftung eines Codes (Tastatur/Maus/Controller). sided: linke/rechte Umschalt-/Strg-Taste unterscheiden. */
export function keyText(G, code, { long = false, sided = false } = {}) {
  warmKeyboardLayout();
  return codeLabel(code, { long: long || (sided && SIDED.test(code)), pad: padStyle(G), layout: kbLayout });
}

/** <kbd>-Markup eines Codes; Controller-Akkorde als zwei Tasten mit „+“, Gesichtstasten farbig (data-pad). */
export function keyHtml(G, code) {
  if (!code) return '<span class="bd-none">—</span>';
  const style = padStyle(G);
  return code.split('+').map((c) => {
    const m = /^Pad(\d+)$/.exec(c);
    const t = esc(keyText(G, c, { sided: true }));
    return m ? `<kbd class="kb-pad" data-pad="${m[1]}" data-ps="${style === 'ps' ? 1 : 0}">${t}</kbd>` : `<kbd>${t}</kbd>`;
  }).join('<i class="kb-plus">+</i>');
}

/**
 * Beschriftung der ersten Belegung einer Aktion für das zuletzt benutzte Gerät (HUD-Hinweise). Touch → ''.
 * Ersetzt die festen Tabellen KEY_HINT/PAD_HINT.
 */
export function actionKey(G, action) {
  const input = G && G.input;
  if (!input || input.mode === 'touch') return '';
  const dev = input.lastDevice === 'gamepad' ? 'pad' : 'kb';
  const list = (input.bindings && input.bindings[dev] && input.bindings[dev][action]) || [];
  return list.length ? keyText(G, list[0]) : '';
}

/* ------------------------------------------------------------ Touch-Layout */

/** Seitenverhältnis-Klasse der Touch-Fläche (bzw. des Fensters). */
export function touchAspect() {
  const r = typeof document !== 'undefined' && document.getElementById('touch-ui');
  const b = r && r.getBoundingClientRect();
  return aspectBucket((b && b.width) || window.innerWidth, (b && b.height) || window.innerHeight);
}

/**
 * Hat die Klasse noch keine eigenen Einträge, gilt (wie in resolveTouchLayout) die nächstgelegene Querformat-Klasse.
 * Vor der ersten eigenen Änderung deren Einträge übernehmen – sonst ginge diese Grundlage verloren.
 */
export function seedAspect(layout, aspect) {
  const L = sanitizeTouchLayout(layout) || sanitizeTouchLayout(null);
  if (L.custom[aspect] || aspect === 'hoch') return L;
  const i = TOUCH_ASPECTS.indexOf(aspect);
  let best = null;
  let bd = 99;
  for (const [k, m] of Object.entries(L.custom)) {
    if (k === 'hoch') continue;
    const d = Math.abs(TOUCH_ASPECTS.indexOf(k) - i);
    if (d < bd) { bd = d; best = m; }
  }
  if (best) L.custom[aspect] = JSON.parse(JSON.stringify(best));
  return L;
}

/** Einen Knopf ändern (mit Übernahme der Grundlage, siehe seedAspect). */
export function editTouch(layout, aspect, id, entry) {
  return setTouchEntry(seedAspect(layout, aspect), aspect, id, entry);
}
