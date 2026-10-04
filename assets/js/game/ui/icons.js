// NULLPUNKT — UI-Icons (Inline-SVG, viewBox 0 0 24 24, Strich = currentColor).

const svg = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;

export const ICON = {
  head: svg('<circle cx="12" cy="9" r="5"/><path d="M8.5 13.5l-.5 3.5h8l-.5-3.5"/><path d="M10 10h.01M14 10h.01" stroke-width="2.4"/>'),
  skull: svg('<path d="M12 3.5c-4.4 0-7.5 3-7.5 7 0 2.4 1.2 4 2.8 5v3h9.4v-3c1.6-1 2.8-2.6 2.8-5 0-4-3.1-7-7.5-7z"/><circle cx="9" cy="11" r="1.7" fill="currentColor"/><circle cx="15" cy="11" r="1.7" fill="currentColor"/><path d="M10.5 18.5v-2M13.5 18.5v-2"/>'),
  explosion: svg('<path d="M12 2.5l1.8 5 4.7-2.5-2 4.9 5 1.6-5 1.8 2.4 4.7-4.9-2-1.9 5-1.6-5-4.8 2.2 2.1-4.8L3 11.5l4.9-1.7L5.6 5l4.7 2.4z"/>'),
  knife: svg('<path d="M3 21l5-5"/><path d="M6.5 17.5L18 6l3-3-1 4L8.5 18.5z"/><path d="M5 14.5l4.5 4.5"/>'),
  fall: svg('<path d="M12 3v13"/><path d="M7 11l5 5 5-5"/><path d="M4 21h16"/>'),
  flag: svg('<path d="M5 21V3.5"/><path d="M5 4.5h12l-2.6 3.8L17 12H5"/>'),
  shield: svg('<path d="M12 3l7 3v5c0 4.6-3 8.3-7 10-4-1.7-7-5.4-7-10V6z"/>'),
  heart: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  plus: svg('<path d="M12 4v16M4 12h16" stroke-width="3.2"/>'),
  bullet: svg('<path d="M9 21V10c0-3 1.4-5.6 3-7 1.6 1.4 3 4 3 7v11z"/><path d="M9 17h6"/>'),
  grenade: svg('<circle cx="12" cy="14" r="6"/><path d="M9.5 8V5.5h5V8M14.5 6c2.5 0 4 1.5 4 4"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
  pad: svg('<path d="M7 8h10a4.5 4.5 0 0 1 4.3 5.8l-1.1 3.6a2.2 2.2 0 0 1-3.8.7L14 15h-4l-2.4 3.1a2.2 2.2 0 0 1-3.8-.7l-1.1-3.6A4.5 4.5 0 0 1 7 8z"/><path d="M7 10.5v3M5.5 12h3"/><circle cx="16" cy="11" r=".8" fill="currentColor"/><circle cx="17.8" cy="12.8" r=".8" fill="currentColor"/>'),
  keyboard: svg('<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 14h10"/>'),
  touch: svg('<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),
  exit: svg('<path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4M6 12h10"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  play: svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
  pause: svg('<path d="M8 5v14M16 5v14" stroke-width="2.6"/>'),
  restart: svg('<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>'),
  lock: svg('<rect x="5.5" y="10.5" width="13" height="10" rx="1.5"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5" stroke-width="2.4"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18" stroke-width="2.2"/>'),
  minus: svg('<path d="M5 12h14" stroke-width="2.6"/>'),
  plusSmall: svg('<path d="M12 5v14M5 12h14" stroke-width="2.6"/>'),
  target: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>'),
  timer: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/>'),
  star: svg('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  crown: svg('<path d="M4 18h16l1-10-5 4-4-7-4 7-5-4z"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.2-6.5 8-6.5s7 2 8 6.5"/>'),
  bot: svg('<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01"/>'),
  map: svg('<path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 3 2.6 15 0 18M12 3c-2.6 3-2.6 15 0 18"/>'),
  sound: svg('<path d="M4 9.5h4l5-4v13l-5-4H4z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>'),
  eye: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  sliders: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  crosshair: svg('<path d="M12 3v6M12 15v6M3 12h6M15 12h6"/>'),
  warn: svg('<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5h.01" stroke-width="2.2"/>'),
  radar: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6.4-6.4"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01" stroke-width="2.2"/>'),
};

/** Medaillen-Abzeichen (Sechseck, Stufenfarbe über CSS --tier). */
export function medalBadge(label, tier = 'bronze') {
  const glyph = String(label || '?').replace(/[^A-Za-zÄÖÜäöü0-9]/g, '').slice(0, 2).toUpperCase() || '★';
  return `<svg class="medal-badge tier-${tier}" viewBox="0 0 40 44" aria-hidden="true">
    <path class="mb-out" d="M20 1.5l17 9.8v19.6L20 40.7 3 30.9V11.3z"/>
    <path class="mb-in" d="M20 6.5l12.7 7.3v14.7L20 35.8 7.3 28.5V13.8z"/>
    <text x="20" y="25.5" text-anchor="middle">${glyph}</text></svg>`;
}
