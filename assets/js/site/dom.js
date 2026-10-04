// Kleine DOM-Helfer.
import { esc } from './fmt.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/** Element erzeugen: h('p.mono-s', { id: 'x' }, 'Text', kind…) */
export function h(tag, attrs = {}, ...kids) {
  const [name, ...cls] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = `${el.className} ${v}`.trim();
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') for (const [p, pv] of Object.entries(v)) el.style.setProperty(p, pv);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}

/** Abschnitts-Fehlerzustand: „KEIN SIGNAL.“ plus ein Satz Grund; der statische Inhalt bleibt. */
export function signalLost(root, reason) {
  if (!root || root.querySelector(':scope > .err-state')) return;
  const box = document.createElement('div');
  box.className = 'err-state';
  box.innerHTML = `<strong>KEIN SIGNAL.</strong>${esc(reason || 'Daten konnten nicht geladen werden.')}`;
  root.appendChild(box);
}

/** WAI-ARIA-Tabs mit Roving-Tabindex und automatischer Aktivierung. */
export function tabs(list, { onSelect, label } = {}) {
  const items = $$('[role=tab]', list);
  list.setAttribute('role', 'tablist');
  if (label) list.setAttribute('aria-label', label);
  const select = (tab, focus = false, user = true) => {
    for (const t of items) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    }
    if (focus) tab.focus();
    onSelect?.(tab, user);
  };
  list.addEventListener('click', (e) => { const t = e.target.closest('[role=tab]'); if (t) select(t, false, true); });
  list.addEventListener('keydown', (e) => {
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    let j = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = items.length - 1;
    if (j === null) return;
    e.preventDefault();
    select(items[j], true, true);
  });
  return { select: (tab, user = false) => select(tab, false, user), items };
}
