// NULLPUNKT — Website. Start: Chrom und Hero sofort, Daten parallel, Abschnitte erst in Sichtnähe.
import { loadData } from './data.js';
import { initNav, setNavSound } from './nav.js';
import { initCursor } from './cursor.js';
import { initZero } from './zero.js';
import { fitAll, fontsReady } from './fit.js';
import { initDeploy } from './deploy.js';
import { sound } from './sound.js';
import { setSettingReduced } from './motion.js';
import { signalLost } from './dom.js';

const html = document.documentElement;
html.classList.remove('no-js');
html.classList.add('js');

function detectWebGL() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch { return false; }
}
const webgl = detectWebGL();
html.classList.toggle('no-webgl', !webgl);
const saveData = !!navigator.connection?.saveData;
const ctx = { sound, webgl, saveData };

/* Chrom + Hero */
initNav();
setNavSound(sound);
initZero({ sound });

const fontsP = (document.fonts?.ready || Promise.resolve()).then(() => {
  fontsReady();
  fitAll(document, { now: true });
});
// Sicherheitsnetz, falls die Schriften hängen
setTimeout(() => { fontsReady(); fitAll(document, { now: true }); }, 3000);

const VIEWS = {
  modes: () => import('./modes-view.js'),
  maps: () => import('./maps-view.js'),
  arsenal: () => import('./arsenal-view.js'),
  profile: () => import('./profile-view.js'),
  settings: () => import('./settings-view.js'),
  controls: () => import('./controls-view.js'),
  about: () => import('./about-view.js'),
};

function heroData(D) {
  const line = document.getElementById('data-line');
  if (!line || !D.ok.modes) return;
  const modes = D.M.MODE_ORDER.length;
  const maps = D.P.MAP_ORDER.length;
  const weapons = D.W ? D.W.WEAPON_IDS.filter((id) => D.W.WEAPONS[id].cls !== 'melee').length : 10;
  let bots = 0;
  for (const id of D.M.MODE_ORDER) {
    const l = D.M.MODES[id].limits;
    if (l) bots = Math.max(bots, (l.allies?.[1] || 0) + (l.enemies?.[1] || 0));
  }
  line.textContent = `${modes} MODI · ${maps} KARTEN · ${weapons} WAFFEN · BIS ZU ${bots} BOTS`;
}

function statusWho(D) {
  const who = document.querySelector('.who');
  if (!who || !D.profile) return;
  const P = D.profile;
  const upd = () => {
    const p = P.get();
    const name = (D.settings.get('playerName') || p.name || 'Operator').toLocaleUpperCase('de-DE');
    document.getElementById('st-callsign').textContent = name;
    document.getElementById('st-level').textContent = `STUFE ${p.level}`;
    const icon = document.getElementById('st-rank');
    try { icon.innerHTML = D.profileMod.rankIcon(p.level, { size: 16 }); } catch { icon.textContent = ''; }
    who.hidden = false;
  };
  upd();
  P.onChange(upd);
  D.settings.onChange((k) => { if (k === 'playerName') upd(); });
}

async function boot() {
  const D = await loadData();
  ctx.D = D;
  sound.init(D.settings);
  initCursor(D.settings);
  setSettingReduced(D.settings.get('reducedMotion'));
  D.settings.onChange((k, v) => { if (k === 'reducedMotion') setSettingReduced(v); });
  heroData(D);
  try { initDeploy(D, { snd: sound, webgl }); } catch (err) { console.error(err); signalLost(document.getElementById('satz')?.parentNode, 'Der Satzbau ist ausgefallen.'); }
  statusWho(D);

  // Abschnitte erst initialisieren, wenn sie innerhalb eines Bildschirms herankommen
  await fontsP;
  const started = new Set();
  const start = async (sec) => {
    const key = sec.dataset.view;
    if (started.has(key) || !VIEWS[key]) return;
    started.add(key);
    try {
      const m = await VIEWS[key]();
      await m.init(sec, D, ctx);
    } catch (err) {
      console.error(`[NULLPUNKT] Abschnitt ${key}:`, err);
      signalLost(sec.querySelector('.content'), 'Dieser Abschnitt konnte nicht aufgebaut werden.');
    }
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); start(e.target); }
  }, { rootMargin: '100% 0px' });
  for (const sec of document.querySelectorAll('section[data-view]')) if (VIEWS[sec.dataset.view]) io.observe(sec);
  // Direktsprung per Anker: Zielabschnitt sofort aufbauen
  const hashSec = location.hash && document.querySelector(`${CSS.escape ? `#${CSS.escape(location.hash.slice(1))}` : location.hash}`)?.closest('section[data-view]');
  if (hashSec) start(hashSec);

  // Fahne (nach einem Match) – klein, wird im Leerlauf geladen
  if (D.profile) {
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 400));
    idle(async () => {
      try { (await import('./fahne.js')).initFahne(D, ctx); } catch (err) { console.error('[NULLPUNKT] Fahne:', err); }
    });
  }
}

boot().catch((err) => console.error('[NULLPUNKT] Start:', err));
