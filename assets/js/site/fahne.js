// Fahne: Nach einem Match fährt unter der Statuszeile ein perforierter Fahnenabzug mit dem
// Ergebnis heraus. Nicht modal; „Abreißen“ per Knopf, Esc oder Wischen (> 48 px senkrecht).
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

export function initFahne(D, ctx = {}) {
  const P = D.profile;
  if (!P) return;
  const snd = ctx.sound;
  let el = null;
  let shownAt = 0;

  // Erster Besuch überhaupt: nur merken, nichts zeigen.
  if (!site.get('initialised')) {
    const p = P.get();
    site.patch({ lastSeenMatchAt: p.history?.[0]?.at || 0, lastSeenLevel: p.level || 1, initialised: true });
  }

  function dismiss() {
    if (!el) return;
    const node = el;
    el = null;
    const p = P.get();
    site.patch({ lastSeenMatchAt: Math.max(site.get('lastSeenMatchAt') || 0, shownAt), lastSeenLevel: p.level || 1 });
    document.removeEventListener('keydown', onKey, true);
    snd?.ui('back');
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
    const line = [modeShort, mapName, `${num(m.kills || 0)} ABSCHÜSSE`, `${num(m.deaths || 0)} TODE`, `${num(m.assists || 0)} ASSISTS`, `${num(m.score || 0)} PUNKTE`].join(' · ');
    const lastLevel = site.get('lastSeenLevel') || 1;
    const levelUp = (p.level || 1) > lastLevel;
    const rankNow = D.profileMod?.rankFor?.(p.level);
    const rankThen = D.profileMod?.rankFor?.(lastLevel);
    const rankUp = levelUp && rankNow && rankThen && rankNow.id !== rankThen.id;

    const maxFs = Math.round(Math.max(48, Math.min(120, window.innerWidth * 0.17)));
    const wordEl = h('p.fahne-word', { 'data-fit': '', 'data-fit-wdth': String(wd), 'data-fit-max': String(maxFs), 'aria-hidden': 'true', style: { '--wdth': String(wd), 'font-weight': String(wg) } }, word, h('span.o', {}, '.'));
    const tear = h('button.txt-btn', { type: 'button' }, 'Abreißen');
    const body = [
      h('p.fahne-head', {}, `FAHNE · EINSATZBERICHT · ${date(m.at)}`),
      h('p.sr-only', {}, `${word.charAt(0)}${word.slice(1).toLowerCase()}.`),
      wordEl,
      h('p.fahne-line', {}, line),
      h('p.fahne-xp', {}, `+${num(m.xp || 0)} EP`),
    ];
    if (levelUp) body.push(h('p.fahne-up', {}, `Stufe ${p.level} erreicht.${rankUp ? ` Neuer Dienstgrad: ${rankNow.name}.` : ''}`));
    if (fresh.length > 1) body.push(h('p.fahne-more', {}, `+${fresh.length - 1} ${fresh.length === 2 ? 'weiterer Einsatz' : 'weitere Einsätze'}`));
    body.push(tear);

    el?.remove();
    el = h('aside.fahne', { 'aria-label': 'Einsatzbericht' }, ...body);
    shownAt = m.at;
    document.body.append(el);
    fit(wordEl, { now: true });

    tear.addEventListener('click', dismiss);
    document.addEventListener('keydown', onKey, true);
    // Wischen zum Abreißen
    let start = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      start = { y: e.clientY, id: e.pointerId };
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id || !el) return;
      const dy = e.clientY - start.y;
      el.style.transform = `translateY(${Math.min(0, dy).toFixed(1)}px)`;
      if (Math.abs(dy) > 48) { start = null; el.style.transform = ''; dismiss(); }
    });
    const end = () => { start = null; if (el) el.style.transform = ''; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

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
