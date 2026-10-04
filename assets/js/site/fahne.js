// Fahne: Nach einem Match fährt unter der Statuszeile ein perforierter Fahnenabzug mit dem
// Ergebnis heraus. Nicht modal. „Abreißen“ steht immer sichtbar in der Kopfzeile; außerdem Esc
// oder ein Wisch nach oben, der an der Abrisskante beginnt.
// Rechner: fest unter der Statuszeile, nach dem Hero auf die Kopfzeile gefaltet (antippen öffnet).
// Telefon und Querformat: liegt oben im Hero und scrollt mit ihm weg.
import { h } from './dom.js';
import { fit } from './fit.js';
import { site } from './state.js';
import { announce } from './live.js';
import { reduced } from './motion.js';
import { num, date } from './fmt.js';

const up = (s) => String(s ?? '').toLocaleUpperCase('de-DE');
const WORD = {
  win: ['SIEG', 900, 125],
  loss: ['NIEDERLAGE', 300, 62],
  draw: ['UNENTSCHIEDEN', 600, 100],
  training: ['TRAINING', 400, 100],
};
export const COMPACT_MQ = '(max-width: 719px), (pointer: coarse) and (max-height: 500px)';

export function initFahne(D, ctx = {}) {
  const P = D.profile;
  if (!P) return;
  const snd = ctx.sound;
  const compact = window.matchMedia(COMPACT_MQ);
  let el = null;
  let wordCur = null;
  let shownAt = 0;
  let heroIo = null;
  compact.addEventListener?.('change', () => { if (el && wordCur) fit(wordCur, { now: true }); });

  // Erster Besuch überhaupt: nur merken, nichts zeigen.
  if (!site.get('initialised')) {
    const p = P.get();
    site.patch({ lastSeenMatchAt: p.history?.[0]?.at || 0, lastSeenLevel: p.level || 1, initialised: true });
  }

  function dismiss() {
    if (!el) return;
    const node = el;
    el = null;
    heroIo?.disconnect();
    heroIo = null;
    const p = P.get();
    site.patch({ lastSeenMatchAt: Math.max(site.get('lastSeenMatchAt') || 0, shownAt), lastSeenLevel: p.level || 1 });
    document.removeEventListener('keydown', onKey, true);
    snd?.ui('back');
    // Fokus nicht im Nichts lassen
    if (node.contains(document.activeElement)) document.querySelector('.brand')?.focus({ preventScroll: true });
    if (reduced()) { node.remove(); return; }
    node.classList.add('out');
    setTimeout(() => node.remove(), 260);
  }

  function onKey(e) {
    if (e.key !== 'Escape' || !el) return;
    const a = document.activeElement;
    const onBody = !a || a === document.body || a === document.documentElement;
    if (!onBody && !el.contains(a)) return;
    if (document.querySelector('dialog[open]')) return;
    dismiss();
  }

  function show(p, fresh) {
    const m = fresh[0];
    const training = m.modeId === 'training';
    const [word, wg, wd] = WORD[training ? 'training' : m.result] || WORD.loss;
    const modeShort = D.M?.MODES?.[m.modeId]?.short || up(m.modeId);
    const mapName = up(D.P?.MAPS?.[m.mapId]?.name || m.mapId);
    const line = [modeShort, mapName, `${num(m.kills || 0)} ABSCHÜSSE`, `${num(m.deaths || 0)} TODE`, `${num(m.assists || 0)} ASSISTS`, `${num(m.score || 0)} PUNKTE`];
    const lastLevel = site.get('lastSeenLevel') || 1;
    const levelUp = (p.level || 1) > lastLevel;
    const rankNow = D.profileMod?.rankFor?.(p.level);
    const rankThen = D.profileMod?.rankFor?.(lastLevel);
    const rankUp = levelUp && rankNow && rankThen && rankNow.id !== rankThen.id;

    const maxFs = () => (compact.matches ? 40 : Math.round(Math.max(48, Math.min(96, window.innerWidth * 0.12))));
    const wordEl = h('p.fahne-word', { 'data-fit': '', 'data-fit-wdth': String(wd), 'aria-hidden': 'true', style: { '--wdth': String(wd), 'font-weight': String(wg) } }, word, h('span.o', {}, '.'));
    wordEl.fitOpts = { max: maxFs };
    const tear = h('button.txt-btn.fahne-tear', { type: 'button' }, 'Abreißen');
    const sum = h('button.fahne-sum', { type: 'button', 'aria-expanded': 'true' },
      h('span.fs-open', {}, `FAHNE · EINSATZBERICHT · ${date(m.at)}`),
      h('span.fs-min', {}, `FAHNE · ${word}. · +${num(m.xp || 0)} EP`));
    const xp = h('p.fahne-xp', {}, `+${num(m.xp || 0)} EP`);
    if (levelUp) xp.append(h('span.fx-up', {}, ` · STUFE ${p.level} ERREICHT${rankUp ? ` · ${up(rankNow.name)}` : ''}`));
    const body = h('div.fahne-body', {},
      h('p.sr-only', {}, `${word.charAt(0)}${word.slice(1).toLowerCase()}.`),
      wordEl,
      h('p.fahne-line', {}, line.map((t, i) => h('span', {}, `${i ? ' · ' : ''}`, h('span.nw', {}, t)))),
      xp,
      levelUp ? h('p.fahne-up', {}, `Stufe ${p.level} erreicht.${rankUp ? ` Neuer Dienstgrad: ${rankNow.name}.` : ''}`) : null,
      fresh.length > 1 ? h('p.fahne-more', {}, `+${fresh.length - 1} ${fresh.length === 2 ? 'weiterer Einsatz' : 'weitere Einsätze'}`) : null);
    const edge = h('div.fahne-edge', { 'aria-hidden': 'true', title: 'Nach oben wischen: abreißen' });

    el?.remove();
    heroIo?.disconnect();
    el = h('aside.fahne', { 'aria-label': 'Einsatzbericht' }, h('div.fahne-headrow', {}, sum, tear), body, edge);
    shownAt = m.at;
    const hero = document.getElementById('nullpunkt') || document.body;
    hero.append(el);
    wordCur = wordEl;
    fit(wordEl, { now: true });

    const node = el;
    tear.addEventListener('click', dismiss);
    sum.addEventListener('click', () => {
      const min = !node.classList.contains('min');
      node.classList.toggle('min', min);
      node.classList.toggle('pinned', !min);
      sum.setAttribute('aria-expanded', String(!min));
      if (!min) fit(wordEl, { now: true });
      snd?.ui('click');
    });
    document.addEventListener('keydown', onKey, true);

    // Rechner: Sobald der Hero aus dem Bild ist, faltet sich die Fahne auf ihre Kopfzeile.
    heroIo = new IntersectionObserver(([e]) => {
      if (!el || compact.matches || node.classList.contains('pinned')) return;
      const min = !e.isIntersecting;
      node.classList.toggle('min', min);
      sum.setAttribute('aria-expanded', String(!min));
    }, { threshold: 0.08 });
    if (hero !== document.body) heroIo.observe(hero);

    // Abreißen per Wisch: nur von der Abrisskante aus, nur nach oben.
    let start = null;
    edge.addEventListener('pointerdown', (e) => {
      start = { y: e.clientY, id: e.pointerId };
      edge.setPointerCapture?.(e.pointerId);
    });
    edge.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id || el !== node) return;
      const dy = Math.min(0, e.clientY - start.y);
      node.style.transform = dy ? `translateY(${dy.toFixed(1)}px)` : '';
      if (dy < -48) { start = null; node.style.transform = ''; dismiss(); }
    });
    const end = () => { start = null; node.style.transform = ''; };
    edge.addEventListener('pointerup', end);
    edge.addEventListener('pointercancel', end);

    const summary = `Einsatzbericht: ${training ? 'Training' : ({ win: 'Sieg', loss: 'Niederlage', draw: 'Unentschieden' }[m.result] || '')}, ${D.M?.MODES?.[m.modeId]?.name || m.modeId}, ${m.kills || 0} Abschüsse, ${m.deaths || 0} Tode, plus ${m.xp || 0} EP.${levelUp ? ` Stufe ${p.level} erreicht.` : ''}`;
    announce(summary);
    if (levelUp) snd?.ui('levelup');
  }

  function check() {
    const p = P.get();
    const seen = site.get('lastSeenMatchAt') || 0;
    const fresh = (p.history || []).filter((m) => (m.at || 0) > seen);
    if (!fresh.length) {
      // Profil geleert (z. B. in einem anderen Tab): Merker angleichen
      if (!(p.history || []).length && seen) site.patch({ lastSeenMatchAt: 0, lastSeenLevel: p.level || 1 });
      return;
    }
    if (el && shownAt === fresh[0].at) return;
    show(p, fresh);
  }

  check();
  P.onChange(() => check());
}
