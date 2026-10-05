// NULLPUNKT — Reiter „HUD“: HUD-Stil (Voll · Reduziert · Realismus wie Bodycam) mit Schema-Vorschau,
// Fadenkreuz (Form, Farbe, Vorschau), Bodycam-Einblendung, FPS-Anzeige.

import { esc } from '../dom.js';
import { rowHtml, headHtml, bindRows, syncRows } from './rows.js';
import { HINTS } from './schema-page.js';

const STYLES = [
  { id: 'voll', label: 'Voll', desc: 'Alles im Blick: Minikarte, Kompass, Munition, Leben, Treffermarker.' },
  { id: 'reduziert', label: 'Reduziert', desc: 'Ohne Minikarte und Kompass, Munition nur als Balken, Leben nur nach Treffern.' },
  { id: 'aus', label: 'Realismus', desc: 'Wie Bodycam: kein Fadenkreuz, keine Munitions- und Lebensanzeige. Nur das Nötigste.' },
];

// Schema je Stil: Minikarte, Punktestand, Kompass, Leben, Munition, Fadenkreuz, Killfeed
function styleArt(id) {
  const full = id === 'voll';
  const red = id === 'reduziert';
  const parts = [
    full ? '<circle class="ha-mm" cx="12" cy="12" r="8"/>' : '',
    `<rect class="ha-top" x="${full ? 38 : 40}" y="3" width="${full ? 24 : 20}" height="5" rx="1"/>`,
    full ? '<rect class="ha-comp" x="34" y="10" width="32" height="2" rx="1"/>' : '',
    full ? '<rect class="ha-hp" x="4" y="51" width="22" height="3" rx="1"/>' : red ? '<rect class="ha-hp is-dim" x="4" y="51" width="16" height="2" rx="1"/>' : '',
    full ? '<rect class="ha-ammo" x="78" y="47" width="18" height="8" rx="1"/>' : red ? '<rect class="ha-ammo is-dim" x="82" y="52" width="14" height="2" rx="1"/>' : '',
    id !== 'aus' ? '<path class="ha-x" d="M50 26v3M50 31v3M45 30h3M52 30h3"/>' : '',
    id !== 'aus' ? '<rect class="ha-feed" x="70" y="16" width="26" height="2" rx="1"/><rect class="ha-feed" x="76" y="20" width="20" height="2" rx="1"/>' : '<rect class="ha-feed is-dim" x="80" y="16" width="16" height="2" rx="1"/>',
  ].join('');
  return `<svg class="ha" viewBox="0 0 100 60" aria-hidden="true"><rect class="ha-bg" width="100" height="60" rx="3"/>${parts}</svg>`;
}

export function hudPage(P) {
  const S = P.settings;
  let host = null;
  let off = null;
  const ROWS = ['crosshairStyle', 'crosshairColor', 'bodycamStamp', 'showFps'];

  function sync() {
    if (!host) return;
    const v = S.get('hudStyle');
    host.querySelectorAll('[data-hs]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.hs === v)));
    const x = host.querySelector('.sp-xh');
    if (x) {
      x.dataset.style = S.get('crosshairStyle');
      x.style.setProperty('--cc', S.get('crosshairColor'));
      x.classList.toggle('is-off', v === 'aus');
    }
    const note = host.querySelector('[data-xh-note]');
    if (note) note.hidden = v !== 'aus';
  }

  return {
    keys: ['hudStyle', ...ROWS],
    resetLabel: 'HUD',
    mount(h) {
      host = h;
      host.innerHTML = `
        ${headHtml('HUD-Stil')}
        <div class="lk-cards hs-cards" role="radiogroup" aria-label="HUD-Stil">
          ${STYLES.map((s) => `<button type="button" class="lk-card" role="radio" data-hs="${s.id}" aria-pressed="false">${styleArt(s.id)}<b>${esc(s.label)}</b><small>${esc(s.desc)}</small></button>`).join('')}
        </div>
        ${headHtml('Fadenkreuz')}
        <div class="sp-xpreview" aria-hidden="true"><div class="sp-xh"><i class="l"></i><i class="r"></i><i class="t"></i><i class="b"></i><i class="c"></i><i class="o"></i></div><span>Vorschau</span><small data-xh-note hidden>Im Stil „Realismus“ ausgeblendet.</small></div>
        ${rowHtml(P, 'crosshairStyle', { hint: 'Schrotflinten zeigen immer den Streukreis.' })}
        ${rowHtml(P, 'crosshairColor')}
        ${headHtml('Anzeigen')}
        ${rowHtml(P, 'bodycamStamp', { hint: HINTS.bodycamStamp })}
        ${rowHtml(P, 'showFps', { hint: HINTS.showFps })}`;
      off = bindRows(host, { ...P, after: sync });
      host.addEventListener('click', onClick);
      sync();
    },
    unmount() { if (off) off(); if (host) host.removeEventListener('click', onClick); host = null; },
    sync(key) { if (!host) return; syncRows(host, P, key); sync(); },
  };

  function onClick(e) {
    const b = e.target.closest('[data-hs]');
    if (!b) return;
    S.set('hudStyle', b.dataset.hs);
    P.sound('click');
    sync();
  }
}
