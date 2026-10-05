// Fahne: Nach einem Match liegt oben im Hero ein perforierter Fahnenabzug mit dem Ergebnis. Nicht modal.
// „Abreißen“ steht immer sichtbar in der Kopfzeile; außerdem Esc oder ein Wisch nach oben, der an der
// Abrisskante beginnt.
// Lage: eigene Zeile des Hero über dem Zielfeld (Rechner: rechtsbündig unter der Abschnittszeile; Telefon und
// quer: an Stelle der Abschnittszeile). Sie verdeckt nichts und scrollt mit dem Hero weg. Aufgeklappt startet
// sie nur, wenn der freie Raum über der Wortmarke reicht – sonst gefaltet auf ihre Kopfzeile (antippen öffnet).
// Ist der Hero nicht im Bild, zeigt die Statuszeile „FAHNE.“; antippen springt zum Bericht.
import { h } from './dom.js';
import { fit } from './fit.js';
import { site } from './state.js';
import { announce } from './live.js';
import { reduced } from './motion.js';
import { num, date, count, TERMS } from './fmt.js';
import { jumpTo } from './jump.js';

const up = (s) => String(s ?? '').toLocaleUpperCase('de-DE');
const WORD = {
  win: ['SIEG', 900, 125],
  loss: ['NIEDERLAGE', 300, 62],
  draw: ['UNENTSCHIEDEN', 600, 100],
  training: ['TRAINING', 400, 100],
};
const SPOKEN = { win: 'Sieg', loss: 'Niederlage', draw: 'Unentschieden', training: 'Training' };
/** Einsätze, die beim allerersten Besuch höchstens so alt sind, gelten noch als neu (geteilter Spiellink → „Zur Website“). */
const RECENT_MS = 30 * 60 * 1000;
export const COMPACT_MQ = '(max-width: 719px), (pointer: coarse) and (max-height: 500px)';

export function initFahne(D, ctx = {}) {
  const P = D.profile;
  if (!P) return;
  const snd = ctx.sound;
  const compact = window.matchMedia(COMPACT_MQ);
  const hero = document.getElementById('nullpunkt');
  const wordmark = document.getElementById('h-null');
  if (!hero) return;
  let el = null;
  let wordCur = null;
  let shownAt = 0;
  let heroIo = null;
  let chip = null;
  compact.addEventListener?.('change', () => { if (el && wordCur) fit(wordCur, { now: true }); });

  // Erster Besuch überhaupt: Ältere Einsätze gelten als gesehen, ein gerade gespielter bekommt seine Fahne.
  if (!site.get('initialised')) {
    const p = P.get();
    const hist = p.history || [];
    const cutoff = Date.now() - RECENT_MS;
    const older = hist.find((m) => (m.at || 0) <= cutoff); // Verlauf: neuester zuerst
    const recentXp = hist.filter((m) => (m.at || 0) > cutoff).reduce((a, m) => a + (m.xp || 0), 0);
    const levelBefore = recentXp && typeof P.levelFor === 'function' ? P.levelFor(Math.max(0, (p.xp || 0) - recentXp)) : p.level;
    site.patch({ lastSeenMatchAt: older?.at || 0, lastSeenLevel: levelBefore || 1, initialised: true });
  }

  /** Wortmarke neu setzen: Quer bemisst sie sich an der Höhe, die neben ihr bleibt (zero.js zählt die Fahne mit). */
  const refitHero = () => { if (wordmark) fit(wordmark); };

  /** Statuszeile: „FAHNE.“, solange ein Bericht liegt und der Hero nicht im Bild ist. */
  function ensureChip() {
    if (chip) return chip;
    const who = document.querySelector('.status .who');
    if (!who) return null;
    chip = h('button.st-fahne', { type: 'button', hidden: true }, 'Fahne', h('span.o', { 'aria-hidden': 'true' }, '.'));
    chip.addEventListener('click', async () => {
      if (!el) return;
      const node = el;
      setOpen(node, true);
      snd?.ui('click');
      await jumpTo('nullpunkt', { focus: false, hash: false });
      if (el === node) node.querySelector('.fahne-sum')?.focus({ preventScroll: true });
    });
    who.append(chip);
    return chip;
  }
  function showChip(on) {
    const c = on ? ensureChip() : chip;
    if (!c) return;
    c.hidden = !on;
    c.parentNode?.classList.toggle('has-fahne', on);
  }

  function setOpen(node, open) {
    node.classList.toggle('min', !open);
    node.querySelector('.fahne-sum')?.setAttribute('aria-expanded', String(open));
    if (open && wordCur) fit(wordCur, { now: true });
    else node.dataset.restH = String(node.offsetHeight); // gefaltete Höhe: so viel Platz nimmt sie der Wortmarke (zero.js)
    refitHero();
  }

  /**
   * Passt die aufgeklappte Fahne in den freien Raum über der Wortmarke, ohne sie zu verschieben oder zu verdecken?
   * Gemessen einmal beim Erscheinen (gefaltet eingesetzt): Zuwachs beim Aufklappen ≤ Leerraum im Zielfeld.
   */
  function fitsOpen(node) {
    const target = document.getElementById('target');
    const cap = document.getElementById('zero-cap');
    if (!target || !wordmark) return false;
    const top = [cap, wordmark].filter((e) => e && e.getClientRects().length).map((e) => e.getBoundingClientRect().top);
    const room = Math.min(...top) - target.getBoundingClientRect().top;
    const folded = node.offsetHeight;
    node.dataset.restH = String(folded);
    node.classList.remove('min');
    fit(wordCur, { now: true });
    const open = node.offsetHeight;
    node.classList.add('min');
    return open - folded + 8 <= room;
  }

  function dismiss() {
    if (!el) return;
    const node = el;
    el = null;
    heroIo?.disconnect();
    heroIo = null;
    showChip(false);
    const p = P.get();
    site.patch({ lastSeenMatchAt: Math.max(site.get('lastSeenMatchAt') || 0, shownAt), lastSeenLevel: p.level || 1 });
    document.removeEventListener('keydown', onKey, true);
    snd?.ui('back');
    // Fokus nicht im Nichts lassen
    if (node.contains(document.activeElement)) document.querySelector('.brand')?.focus({ preventScroll: true });
    const gone = () => { node.remove(); if (!el) hero.classList.remove('has-fahne'); refitHero(); };
    if (reduced()) { gone(); return; }
    node.classList.add('out');
    setTimeout(gone, 260);
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
    const kind = training ? 'training' : (WORD[m.result] ? m.result : 'loss');
    const [word, wg, wd] = WORD[kind];
    const modeShort = D.M?.MODES?.[m.modeId]?.short || up(m.modeId);
    const mapName = up(D.P?.MAPS?.[m.mapId]?.name || m.mapId);
    const line = [modeShort, mapName, count(m.kills, 'kills', { upper: true }), count(m.deaths, 'deaths', { upper: true }),
      count(m.assists, 'assists', { upper: true }), count(m.score, 'points', { upper: true })];
    const lastLevel = site.get('lastSeenLevel') || 1;
    const levelUp = (p.level || 1) > lastLevel;
    const rankNow = D.profileMod?.rankFor?.(p.level);
    const rankThen = D.profileMod?.rankFor?.(lastLevel);
    const rankUp = levelUp && rankNow && rankThen && rankNow.id !== rankThen.id;
    const xpText = `+${num(m.xp || 0)} ${TERMS.xp}`;

    const maxFs = () => (compact.matches ? 40 : Math.round(Math.max(48, Math.min(96, window.innerWidth * 0.12))));
    const wordEl = h('p.fahne-word', { 'data-fit': '', 'data-fit-wdth': String(wd), 'aria-hidden': 'true', style: { '--wdth': String(wd), 'font-weight': String(wg) } }, word, h('span.o', {}, '.'));
    wordEl.fitOpts = { max: maxFs };
    const tear = h('button.txt-btn.fahne-tear', { type: 'button' }, 'Abreißen');
    // Gefaltet: Ergebnis, EP und Aufstieg in einer Zeile (bricht nur an den Mittelpunkten)
    const nw = (t) => h('span.nw', {}, t);
    const minParts = [nw('FAHNE'), h('b.fs-word', {}, `${word}.`), nw(xpText)];
    if (levelUp) minParts.push(nw(`STUFE ${p.level}`));
    const sum = h('button.fahne-sum', { type: 'button', 'aria-expanded': 'false' },
      h('span.fs-open', {}, `FAHNE · EINSATZBERICHT · ${date(m.at)}`),
      h('span.fs-min', {}, minParts.flatMap((n, i) => (i ? [' · ', n] : [n]))));
    const xp = h('p.fahne-xp', {}, xpText);
    if (levelUp) xp.append(h('span.fx-up', {}, ` · STUFE ${p.level} ERREICHT${rankUp ? ` · ${up(rankNow.name)}` : ''}`));
    const body = h('div.fahne-body', {},
      h('p.sr-only', {}, `${SPOKEN[kind]}.`),
      wordEl,
      h('p.fahne-line', {}, line.map((t, i) => h('span', {}, `${i ? ' · ' : ''}`, h('span.nw', {}, t)))),
      xp,
      levelUp ? h('p.fahne-up', {}, `Stufe ${p.level} erreicht.${rankUp ? ` Neuer Dienstgrad: ${rankNow.name}.` : ''}`) : null,
      fresh.length > 1 ? h('p.fahne-more', {}, `+${num(fresh.length - 1)} ${fresh.length === 2 ? 'weiterer Einsatz' : 'weitere Einsätze'}`) : null);
    const edge = h('div.fahne-edge', { 'aria-hidden': 'true', title: 'Nach oben wischen: abreißen' });

    el?.remove();
    heroIo?.disconnect();
    el = h('aside.fahne.min', { 'aria-label': 'Einsatzbericht' }, h('div.fahne-headrow', {}, sum, tear), body, edge);
    shownAt = m.at;
    hero.classList.add('has-fahne');
    hero.append(el);
    wordCur = wordEl;
    const node = el;
    // Aufgeklappt nur, wenn das ohne Verschieben oder Verdecken der Wortmarke geht
    setOpen(node, fitsOpen(node));

    tear.addEventListener('click', dismiss);
    sum.addEventListener('click', () => {
      setOpen(node, node.classList.contains('min'));
      snd?.ui('click');
    });
    document.addEventListener('keydown', onKey, true);

    // Statuszeile: Verweis auf den Bericht, solange der Hero nicht im Bild ist
    heroIo = new IntersectionObserver(([e]) => { if (el === node) showChip(!e.isIntersecting); }, { threshold: 0 });
    heroIo.observe(hero);

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

    const summary = `Einsatzbericht: ${SPOKEN[kind]}, ${D.M?.MODES?.[m.modeId]?.name || m.modeId}, ${count(m.kills, 'kills')}, ${count(m.deaths, 'deaths')}, plus ${num(m.xp || 0)} ${TERMS.xpLong}.${levelUp ? ` Stufe ${p.level} erreicht.` : ''}`;
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
