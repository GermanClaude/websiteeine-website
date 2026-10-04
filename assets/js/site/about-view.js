// §08 Über: Datenschutz (lokale Daten löschen) und das optionale Impressum aus config.js.
import { $, h } from './dom.js';
import { IMPRESSUM } from './config.js';
import { site } from './state.js';
import { announce } from './live.js';

/** Alle Schlüssel 'nullpunkt:*' im lokalen Speicher. */
function ourKeys() {
  const out = [];
  try {
    const ls = window.localStorage;
    for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && k.startsWith('nullpunkt:')) out.push(k); }
  } catch { /* kein Speicher */ }
  return out;
}

function impressum() {
  const box = document.getElementById('impressum');
  const body = document.getElementById('impressum-body');
  const I = IMPRESSUM || {};
  const val = (k) => (typeof I[k] === 'string' ? I[k].trim() : '');
  if (!box || !body || !val('name')) return;
  const addr = h('address', {},
    val('name'), h('br'),
    val('street') ? [val('street'), h('br')] : null,
    val('city') ? [val('city'), h('br')] : null,
    val('country') ? [val('country'), h('br')] : null);
  const contact = h('p', {},
    val('email') ? ['E-Mail: ', h('a', { href: `mailto:${val('email')}` }, val('email'))] : null,
    val('email') && val('phone') ? h('br') : null,
    val('phone') ? `Telefon: ${val('phone')}` : null);
  body.replaceChildren(h('p.small', {}, 'Angaben gemäß § 5 DDG'), addr, contact.childNodes.length ? contact : null,
    val('responsible') ? h('p', {}, `Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV: ${val('responsible')}`) : null);
  box.hidden = false;
}

export async function init(sec, D, ctx = {}) {
  impressum();
  const open = $('#wipe-open', sec);
  const dlg = document.getElementById('wipe-dialog');
  const go = document.getElementById('wipe-go');
  if (!open || !dlg || !go) return;
  const snd = ctx.sound;
  if (typeof dlg.showModal !== 'function') { open.hidden = true; return; }

  open.addEventListener('click', () => { dlg.showModal(); snd?.ui('click'); });
  dlg.querySelector('[data-close]')?.addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { open.focus(); snd?.ui('back'); });
  go.addEventListener('click', () => {
    try { D.profile?.reset(); } catch { /* egal */ }
    try { D.settings?.reset(); } catch { /* egal */ }
    site.wipe();
    // Erst nach den Zurücksetzungen: alles mit unserem Präfix entfernen (die Stores schreiben beim Zurücksetzen neu).
    for (const k of ourKeys()) { try { window.localStorage.removeItem(k); } catch { /* egal */ } }
    dlg.close();
    announce('Gelöscht.', { now: true });
  });
}
