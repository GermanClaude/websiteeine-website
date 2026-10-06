// NULLPUNKT — Reiter „Grafik“: Qualitätsstufe, Bildstil-Vorlagen („Bodycam-Optik“ & Co., setzen mehrere Werte auf
// einmal), Sichtfeld, Komfort gegen Reiseübelkeit (Kamerabewegung, Waffenschwanken, Fischauge, Rauschen,
// Bewegung reduzieren) und Bild. Alles Weitere unter „Erweitert“.

import { esc } from '../dom.js';
import { ICON } from '../icons.js';
import { rowHtml, headHtml, bindRows, syncRows } from './rows.js';
import { HINTS } from './schema-page.js';

/** Bildstil-Vorlagen: jede setzt diese Werte (alles andere bleibt). */
export const LOOKS = [
  {
    id: 'realistisch', label: 'Realistisch', desc: 'Der Standard: realistisches Licht und natürliche Körperbewegung, nur ein Hauch Objektiv und Rauschen.',
    set: { lensStyle: 'bodycam', lensStrength: 0.15, grain: 0.2, lensArtifacts: 0.05, lensBorder: false, autoExposure: true, cameraMotion: 0.6, weaponPose: 'auto', weaponSway: 1, bodycamStamp: false },
  },
  {
    id: 'bodycam', label: 'Bodycam', desc: 'Wie eine Helmkamera: deutliches Fischauge, Rauschen, leichte Kompression.',
    set: { lensStyle: 'bodycam', lensStrength: 0.7, grain: 0.6, lensArtifacts: 0.35, lensBorder: false, autoExposure: true, cameraMotion: 0.6, weaponPose: 'auto', weaponSway: 1, bodycamStamp: false },
  },
  {
    id: 'echt', label: 'Bodycam · Echt', desc: 'Wie eine echte Aufnahme: Gehäuserand, Zeitstempel, tiefe Waffenhaltung, mehr Bildfehler.',
    set: { lensStyle: 'bodycam', lensStrength: 0.85, grain: 0.7, lensArtifacts: 0.5, lensBorder: true, autoExposure: true, cameraMotion: 0.75, weaponPose: 'bodycam', weaponSway: 1, bodycamStamp: true },
  },
  {
    id: 'komfort', label: 'Bodycam · Komfort', desc: 'Gleicher Look, aber ruhige Kamera und wenig Verzeichnung – gegen Reiseübelkeit.',
    set: { lensStyle: 'bodycam', lensStrength: 0.3, grain: 0.35, lensArtifacts: 0.15, lensBorder: false, autoExposure: true, cameraMotion: 0.15, weaponPose: 'auto', weaponSway: 0.45, bodycamStamp: false },
  },
  {
    id: 'klassisch', label: 'Klassisch', desc: 'Kräftige Farben, feste Belichtung, ruhiges Bild – der bisherige Look.',
    set: { lensStyle: 'klassisch', lensBorder: false, cameraMotion: 0.35, weaponPose: 'standard', weaponSway: 0.8, bodycamStamp: false },
  },
  {
    id: 'klar', label: 'Klar', desc: 'Realistisches Licht ohne Objektivfehler: kein Fischauge, kein Rauschen.',
    set: { lensStyle: 'aus', autoExposure: true, lensBorder: false, cameraMotion: 0.3, weaponPose: 'auto', weaponSway: 0.7, bodycamStamp: false },
  },
];
const LOOK_KEYS = [...new Set(LOOKS.flatMap((l) => Object.keys(l.set)))];

/** Aktive Vorlage (alle Werte gleich) oder null. */
export function activeLook(S) {
  for (const l of LOOKS) if (Object.entries(l.set).every(([k, v]) => S.get(k) === v)) return l.id;
  return null;
}

// Kleine Vorschau je Vorlage (SVG): Gitter gerade/gebogen, Rand, Rauschen
function lookArt(id) {
  const curved = id === 'bodycam' || id === 'echt' || id === 'komfort' || id === 'realistisch';
  const k = id === 'echt' ? 8.5 : id === 'bodycam' ? 7 : id === 'komfort' ? 3 : id === 'realistisch' ? 1.5 : 0;
  const v = [20, 40, 60, 80].map((x) => {
    const dx = (x - 50) / 50;
    return `<path d="M${x} 0 Q${(x + dx * k).toFixed(1)} 30 ${x} 60"/>`;
  }).join('');
  const h = [15, 30, 45].map((y) => {
    const dy = (y - 30) / 30;
    return `<path d="M0 ${y} Q50 ${(y + dy * k * 0.8).toFixed(1)} 100 ${y}"/>`;
  }).join('');
  const grain = curved ? '<rect class="la-grain" width="100" height="60"/>' : '';
  const border = id === 'echt' ? '<rect class="la-border" x="1.5" y="1.5" width="97" height="57" rx="9"/>' : '';
  const stamp = id === 'echt' ? '<text class="la-stamp" x="94" y="9" text-anchor="end">NP-K2 14:32:07</text>' : '';
  return `<svg class="la la-${id}" viewBox="0 0 100 60" aria-hidden="true"><rect class="la-bg" width="100" height="60"/><g class="la-grid${curved ? ' is-curved' : ''}">${v}${h}</g><circle class="la-sun" cx="74" cy="17" r="6"/>${grain}${border}${stamp}</svg>`;
}

export function displayPage(P) {
  const S = P.settings;
  let host = null;
  let off = null;
  const ROWS = {
    qualitaet: ['quality'],
    sicht: ['fov'],
    komfort: ['cameraMotion', 'weaponSway', 'lensStrength', 'grain', 'reducedMotion'],
    bild: ['lensStyle', 'lensArtifacts', 'lensBorder', 'autoExposure', 'weaponPose'],
  };

  function syncLooks() {
    if (!host) return;
    const a = activeLook(S);
    host.querySelectorAll('[data-look]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.look === a)));
    const own = host.querySelector('[data-look-own]');
    if (own) own.hidden = !!a;
    const sys = host.querySelector('[data-sysrm]');
    if (sys) sys.hidden = !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  return {
    keys: ['quality', 'fov', ...LOOK_KEYS, 'reducedMotion'],
    resetLabel: 'Grafik',
    mount(h) {
      host = h;
      const rows = (keys) => keys.map((k) => rowHtml(P, k, { hint: HINTS[k], control: k === 'quality' ? 'seg' : undefined, wide: k === 'quality' })).join('');
      host.innerHTML = `
        ${headHtml('Bildstil')}
        <div class="lk-cards lk-looks" role="group" aria-label="Bildstil-Vorlagen">
          ${LOOKS.map((l) => `<button type="button" class="lk-card" data-look="${l.id}" aria-pressed="false">${lookArt(l.id)}<b>${esc(l.label)}</b><small>${esc(l.desc)}</small></button>`).join('')}
        </div>
        <p class="sp-tip" data-look-own hidden>${ICON.info}Eigene Einstellung – eine Vorlage stellt alle Werte darunter auf einmal.</p>
        ${headHtml('Qualität')}
        ${rows(ROWS.qualitaet)}
        <div class="sp-linkrow"><button type="button" class="m-btn m-ghost" data-act="advanced">${ICON.chip}<span>Erweitert: Schatten, Auflösung, Grafikspeicher …</span></button></div>
        ${headHtml('Sicht')}
        ${rows(ROWS.sicht)}
        ${headHtml('Komfort')}
        <p class="sp-tip">${ICON.info}Wird dir beim Spielen übel? Kamerabewegung und Waffenträgheit senken, Fischauge verringern, Sichtfeld erhöhen – oder die Vorlage „Bodycam · Komfort“. Ganz ohne HUD wie bei Bodycam: HUD → „Realismus“.</p>
        <p class="sp-tip is-on" data-sysrm hidden>${ICON.check}Systemeinstellung „Bewegung reduzieren“ ist aktiv: Kamerabewegung höchstens 15 %, halbe Verzeichnung.</p>
        ${rows(ROWS.komfort)}
        ${headHtml('Bild')}
        ${rows(ROWS.bild)}`;
      off = bindRows(host, { ...P, after: () => syncLooks() });
      host.addEventListener('click', onClick);
      syncLooks();
    },
    unmount() { if (off) off(); if (host) host.removeEventListener('click', onClick); host = null; },
    sync(key) { if (!host) return; syncRows(host, P, key); syncLooks(); },
  };

  function onClick(e) {
    const b = e.target.closest('[data-look]');
    if (b) {
      const look = LOOKS.find((l) => l.id === b.dataset.look);
      if (!look) return;
      const before = {};
      for (const k of Object.keys(look.set)) before[k] = S.get(k);
      S.patch(look.set);
      P.sound('confirm');
      if (P.toast) P.toast(`Bildstil „${look.label}“ eingestellt.`, 'info', () => S.patch(before));
      syncLooks();
      return;
    }
    if (e.target.closest('[data-act="advanced"]')) P.openTab('erweitert');
  }
}
