// NULLPUNKT — Hinweis auf neue Fassung: vergleicht die geladene Fassung (shared/build.js) mit version.json, das
// ohne Browser-Cache geholt wird. Gibt es eine neuere, erscheint (nur in der Lobby) „Neue Version verfügbar“.
// „Jetzt aktualisieren“ holt alle vorgeladenen Module und Stile am Cache vorbei neu und lädt die Seite neu –
// so laufen nach einem Update keine alten Dateien aus dem Browser-Cache weiter.
import { BUILD } from '../../shared/build.js';

export function watchForUpdates({ isIdle = () => true, interval = 5 * 60 * 1000 } = {}) {
  if (BUILD === 'dev' || typeof fetch !== 'function' || typeof document === 'undefined') return;
  let shown = false;
  const check = async () => {
    if (shown || document.hidden) return;
    try {
      const r = await fetch(new URL('version.json', document.baseURI), { cache: 'no-store' });
      if (!r.ok) return;
      const v = await r.json();
      if (v && v.build && v.build !== BUILD && isIdle()) { shown = true; showBanner(); }
    } catch { /* offline o. Ä. – später erneut */ }
  };
  check();
  setInterval(check, interval);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}

function showBanner() {
  const el = document.createElement('div');
  el.className = 'np-update';
  el.setAttribute('role', 'status');
  el.innerHTML = '<span>Neue Version verfügbar.</span>'
    + '<button type="button" data-u="go">Jetzt aktualisieren</button>'
    + '<button type="button" data-u="later" aria-label="Später">Später</button>';
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.u === 'later') { el.remove(); return; }
    b.disabled = true; b.textContent = 'Lädt …';
    refreshAndReload();
  });
  document.body.appendChild(el);
}

async function refreshAndReload() {
  const urls = new Set([location.href.split('#')[0]]);
  for (const l of document.querySelectorAll('link[rel="modulepreload"], link[rel="stylesheet"], link[rel="preload"], link[rel="manifest"]')) {
    if (l.href) urls.add(l.href);
  }
  const list = [...urls];
  let i = 0;
  const worker = async () => {
    while (i < list.length) { const u = list[i++]; try { await fetch(u, { cache: 'reload' }); } catch { /* weiter */ } }
  };
  try { await Promise.all(Array.from({ length: 6 }, worker)); } catch { /* egal */ }
  location.reload();
}
