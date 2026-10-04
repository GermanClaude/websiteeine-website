// §05 Profil: Dein Schnitt. Die eigenen Werte schneiden eine persönliche Archivo:
// Stärke aus K/D, Breite aus Genauigkeit. Dazu Dienstgrad, Kennzahlen, Lieblingswaffen,
// Medaillen und der Verlauf als Glyphenzeile.
import { h, $, signalLost } from './dom.js';
import { fit } from './fit.js';
import { buildPlayUrl, mapPrep } from './deploy.js';
import { cutW, cutG } from './cuts.js';
import { ui } from './state.js';
import { announce } from './live.js';
import { reduced, tween, ease } from './motion.js';
import { num, pct, dur, clock, day, dateLong, clamp, clamp01, NNBSP } from './fmt.js';

const up = (s) => String(s ?? '').toLocaleUpperCase('de-DE');
const RESULT = { win: ['S', 'Sieg', 'win'], loss: ['N', 'Niederlage', 'loss'], draw: ['U', 'Unentschieden', 'draw'] };

export async function init(sec, D, ctx = {}) {
  const root = $('#profile-root', sec);
  if (!root) return;
  const P = D.profile;
  const PM = D.profileMod;
  const S = D.settings;
  const snd = ctx.sound;
  if (!P) { signalLost(root, 'Das Profil ist nicht verfügbar. Spielen geht trotzdem.'); return; }

  /* ------------------------------------------------------------ Gerüst */
  const cut = h('p.callsign-cut', { 'data-fit': '', 'data-fit-max': '240' });
  const cutLabel = h('span');
  const rename = h('button.txt-btn', { type: 'button' }, 'Namen ändern');
  const cutBox = h('div.cut-box', {}, cut, h('p.cut-label', {}, cutLabel, rename));

  const rankIc = h('span.rank-ic-l', { 'aria-hidden': 'true' });
  const rankName = h('p.rank-name', { 'data-fit': '', 'data-fit-grow': '0', 'data-fit-wdth': '100' });
  const stufeWord = h('span.stufe-word', {}, 'STUFE', h('span.stufe-n'));
  const stufeTrack = h('span.stufe-track', { 'aria-hidden': 'true' }, h('i'));
  const xpLine = h('p.xp-line');
  const stufeSr = h('span.sr-only');
  const rank = h('div.rank-block', {}, rankIc, rankName, h('div.stufe', {}, stufeSr, h('span', { 'aria-hidden': 'true' }, stufeWord), stufeTrack), xpLine);

  const FIG = [
    ['kd', 'K/D'], ['acc', 'Genauigkeit'], ['hs', 'Kopfschüsse'], ['wins', 'Siege'],
    ['streak', 'Beste Serie'], ['far', 'Weitester Abschuss'], ['time', 'Spielzeit'], ['matches', 'Matches'],
  ];
  const figEls = {};
  const figures = h('dl.figures');
  for (const [k, label] of FIG) {
    const dd = h('dd');
    figEls[k] = { dd, v: null };
    figures.append(h('div', {}, h('dt', {}, label), dd));
  }
  const favs = h('ul.favs');
  const favBox = h('div.prof-block', {}, h('h3.prof-h', {}, 'Lieblingswaffen'), favs);
  const medals = h('ul.medals');
  const medBox = h('div.prof-block', {}, h('h3.prof-h', {}, 'Medaillen'), medals);
  const hist = h('ol.history', { 'aria-label': 'Verlauf, älteste links' });
  const histDetail = h('p.hist-detail', { 'aria-live': 'off' });
  const histBox = h('div.prof-block', {}, h('h3.prof-h', {}, 'Verlauf'), hist, histDetail);

  const emptyLink = h('a.play-link', { href: buildPlayUrl(), 'data-kill': '', 'data-play': '' }, 'Ersten Einsatz starten', h('span.o', {}, '.'));
  const empty = h('div.prof-empty', {}, h('p', {}, 'Noch kein Einsatz. Dein Schnitt ist ungeschrieben.'), emptyLink);
  const resetBtn = h('button.txt-btn', { type: 'button' }, 'Profil zurücksetzen');
  const tools = h('div.prof-tools', {}, resetBtn);

  const top = h('div.span.prof-top', {}, h('div.r', {}, rank), h('div.m', {}, cutBox));
  const body = h('div.span.prof-body', {}, h('div.r', {}, favBox, medBox), h('div.m', {}, empty, figures, histBox, tools));
  root.replaceChildren();
  root.hidden = true;
  sec.append(top, body);

  /* ------------------------------------------------------------ Rendern */
  let selHist = -1;
  let lastHistKey = '';

  function setFig(k, v, fmt) {
    const f = figEls[k];
    const from = f.v;
    f.v = v;
    if (typeof v !== 'number' || from === null || from === v || reduced() || !Number.isFinite(from)) { f.dd.innerHTML = fmt(v); return; }
    tween(600, (p) => { f.dd.innerHTML = fmt(from + (v - from) * p); }, ease.out, { kinetic: false });
  }

  function render() {
    const p = P.get();
    const st = P.stats();
    const n = p.matches || 0;
    const prog = st.progress || (PM?.levelProgress ? PM.levelProgress(p.xp) : { level: p.level, progress: 0, xpIntoLevel: 0, xpForNext: 0, isMax: false });
    const name = up(S.get('playerName') || p.name || 'Operator');

    // Schnitt
    const wg = n ? Math.round(100 + 800 * clamp01(st.kd / 3)) : 400;
    const wd = n ? Math.round(62 + 63 * clamp01((st.accuracy - 0.1) / 0.4)) : 100;
    cut.textContent = name;
    cut.dataset.fitWdth = String(wd);
    cut.style.setProperty('--wdth', String(wd));
    cut.style.setProperty('--wght', String(wg));
    cut.style.fontWeight = String(wg);
    cutLabel.textContent = `ARCHIVO ${wg} / ${wd}`;
    fit(cut, { now: true });

    // Dienstgrad
    const r = st.rank || PM?.rankFor?.(p.level);
    try { rankIc.innerHTML = PM?.rankIcon ? PM.rankIcon(p.level, { size: 48, title: false }) : ''; } catch { rankIc.textContent = ''; }
    if (rankName.textContent !== (r?.name || '')) { rankName.textContent = r?.name || ''; fit(rankName, { now: true }); }
    stufeWord.querySelector('.stufe-n').textContent = ` ${p.level}`;
    stufeWord.style.setProperty('--sw', (62 + 63 * clamp01(prog.progress)).toFixed(1));
    stufeTrack.style.setProperty('--p', clamp01(prog.progress).toFixed(3));
    stufeSr.textContent = `Stufe ${p.level}, ${Math.round(clamp01(prog.progress) * 100)} Prozent bis zur nächsten.`;
    xpLine.textContent = prog.isMax ? 'Höchststufe erreicht.' : `${num(prog.xpIntoLevel)} / ${num(prog.xpForNext)} EP bis Stufe ${p.level + 1}`;

    // Leerzustand
    const none = n === 0;
    empty.hidden = !none;
    figures.hidden = none;
    favBox.hidden = none;
    medBox.hidden = none;
    histBox.hidden = none;
    tools.hidden = none;
    if (none) { emptyLink.setAttribute('href', buildPlayUrl()); return; }

    // Kennzahlen
    setFig('kd', st.kd, (v) => num(v, 2, 2));
    setFig('acc', st.accuracy, (v) => pct(v));
    setFig('hs', st.headshotRate, (v) => pct(v));
    setFig('wins', p.wins, (v) => `${num(Math.round(v))}<small><span class="sep">·</span>N${NNBSP}${num(p.losses)}<span class="sep">·</span>U${NNBSP}${num(p.draws)}</small>`);
    setFig('streak', p.bestStreak, (v) => num(Math.round(v)));
    setFig('far', p.longestKill, (v) => `${num(Math.round(v))}${NNBSP}m`);
    setFig('time', p.playtime, (v) => dur(v));
    setFig('matches', n, (v) => num(Math.round(v)));

    // Lieblingswaffen
    const W = D.W?.WEAPONS || {};
    const top3 = Object.entries(p.weaponStats || {}).filter(([id, s]) => s.kills > 0 && W[id]).sort((a, b) => b[1].kills - a[1].kills).slice(0, 3);
    favs.replaceChildren(...top3.map(([id, s]) => {
      const def = W[id];
      const a = h('a', { href: '#arsenal', 'data-weapon': id },
        h('span.nm', { style: { '--wdth': cutW(def).toFixed(1), '--wght': String(Math.round(cutG(def))) } }, def.name),
        h('span.nf', {}, `${num(s.kills)} Abschüsse · ${pct(s.shots ? s.hits / s.shots : 0)} Treffer`));
      a.addEventListener('click', (e) => {
        e.preventDefault();
        ui.patch({ weapon: id, weaponPicked: true });
        snd?.ui('click');
        Promise.resolve(ctx.ensure?.('arsenal')).then(() => {
          const t = document.querySelector('#arsenal .stage') || document.getElementById('arsenal');
          t?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: t.classList.contains('stage') ? 'center' : 'start' });
        });
      });
      return h('li', {}, a);
    }));
    favBox.hidden = !top3.length;

    // Medaillen
    const MED = D.M?.MEDALS || {};
    // Nur bekannte Medaillen (unbekannte Kennungen nie roh zeigen)
    const meds = Object.entries(p.medals || {}).filter(([id, c]) => c > 0 && MED[id]).sort((a, b) => b[1] - a[1]).slice(0, 6);
    medals.replaceChildren(...meds.map(([id, c]) => {
      const m = MED[id];
      const tier = m?.tier || '';
      return h('li', {}, h('span.mn', {}, `${m.label || m.name} ×${num(c)}`), tier ? h(`span.mt${tier === 'gold' ? '.gold' : ''}`, {}, up(tier)) : null);
    }));
    medBox.hidden = !meds.length;

    // Verlauf (älteste links)
    const H = (p.history || []).slice(0, 25).reverse();
    const key = H.map((x) => x.at).join();
    if (key !== lastHistKey) {
      lastHistKey = key;
      selHist = -1;
      histDetail.textContent = '';
      hist.replaceChildren(...H.map((m, i) => {
        const training = m.modeId === 'training';
        const [L, word, cls] = training ? ['T', 'Training', 'train'] : (RESULT[m.result] || RESULT.loss);
        const kills = m.kills || 0;
        const deaths = m.deaths || 0;
        const wg = Math.round(100 + 800 * clamp01(kills / 30));
        const wd = Math.round(62 + 63 * clamp01(kills / Math.max(1, deaths) / 3));
        const mode = D.M?.MODES?.[m.modeId]?.name || m.modeId;
        const mapName = D.P?.MAPS?.[m.mapId]?.name || m.mapId;
        const label = `${word}, ${mode} ${mapPrep(m.mapId)} ${mapName}, ${kills} Abschüsse, ${deaths} Tode, ${dateLong(m.at)}`;
        const b = h(`button.hist-g.${cls}`, { type: 'button', 'aria-pressed': 'false', 'aria-label': label, style: { '--wdth': String(wd), '--wght': String(wg) } }, L);
        b.addEventListener('click', () => {
          selHist = selHist === i ? -1 : i;
          for (const [j, el] of [...hist.querySelectorAll('.hist-g')].entries()) el.setAttribute('aria-pressed', String(j === selHist));
          if (selHist < 0) { histDetail.textContent = ''; return; }
          const short = D.M?.MODES?.[m.modeId]?.short || up(m.modeId);
          histDetail.textContent = `${L} · ${short} · ${up(mapName)} · ${kills}/${deaths}/${m.assists || 0} · ${num(m.score || 0)} PUNKTE · +${num(m.xp || 0)} EP · ${clock(m.duration)} MIN · ${day(m.at)}`;
          snd?.ui('click');
        });
        return h('li', {}, b);
      }));
    }
  }

  /* ------------------------------------------------------------ Aktionen */
  rename.addEventListener('click', async () => {
    await ctx.ensure?.('settings');
    const input = document.getElementById('set-playerName');
    if (input) {
      input.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
      input.focus({ preventScroll: true });
      input.select?.();
    }
  });

  let armT = 0;
  resetBtn.addEventListener('click', () => {
    if (!resetBtn.classList.contains('armed')) {
      resetBtn.classList.add('armed');
      resetBtn.textContent = 'Wirklich? Alles weg.';
      clearTimeout(armT);
      armT = setTimeout(() => { resetBtn.classList.remove('armed'); resetBtn.textContent = 'Profil zurücksetzen'; }, 4000);
      return;
    }
    clearTimeout(armT);
    resetBtn.classList.remove('armed');
    resetBtn.textContent = 'Profil zurücksetzen';
    P.reset();
    announce('Profil gelöscht.', { now: true });
    snd?.ui('back');
  });

  render();
  P.onChange(() => render());
  S.onChange((k) => { if (k === 'playerName') render(); });
  P.ready?.then?.(() => render());
}
