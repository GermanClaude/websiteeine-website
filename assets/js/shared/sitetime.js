// NULLPUNKT — Zeit auf der Webseite (sichtbarer Tab, Startseite und alle Bereiche). Nutzer 13.10.: im Zwiegespräch steht die
// genaue Zeit „Spielzeit + Webseite“ statt „zwanzig Minuten, eher länger“. localStorage 'nullpunkt:webzeit' = { sec }.
// Mehrere Tabs addieren jeweils ihren Anteil (vor dem Schreiben frisch gelesen).
const KEY = 'nullpunkt:webzeit';
let since = 0, started = false;

function stored() {
  try { return Math.max(0, Number(JSON.parse(localStorage.getItem(KEY) || '{}').sec) || 0); } catch { return 0; }
}
function running() { return since ? (performance.now() - since) / 1000 : 0; }
function flush() {
  const add = running();
  since = document.visibilityState === 'visible' ? performance.now() : 0;
  if (add > 0 && add < 6 * 3600) { try { localStorage.setItem(KEY, JSON.stringify({ sec: Math.round(stored() + add) })); } catch { /* gesperrt */ } }
}

/** Uhr starten (einmal je Seite, Startseite ruft das beim Laden auf). */
export function startSiteClock() {
  if (started || typeof document === 'undefined') return;
  started = true;
  if (document.visibilityState === 'visible') since = performance.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { if (!since) since = performance.now(); } else flush();
  });
  addEventListener('pagehide', flush);
  setInterval(() => { if (since) flush(); }, 30000);
}

/** Sekunden auf der Webseite insgesamt (gespeichert + laufend). */
export function siteSeconds() { return stored() + running(); }
