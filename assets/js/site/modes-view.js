// §02 Modi: Regelwerk. Fünf Zeilen als Aufklapper; jeder Name spielt seine Regel vor
// (Fokus, Öffnen, Mitte des Bildschirms beim Scrollen, Maus als Zugabe). Dazu SERIEN.
import { h, $, signalLost } from './dom.js';
import { fit } from './fit.js';
import { split, Kinetic } from './kinetic.js';
import { buildPlayUrl, rememberLaunch } from './deploy.js';
import { ui } from './state.js';
import { calm, reduced, pointerFine, ease } from './motion.js';
import { clamp } from './fmt.js';

const up = (s) => String(s ?? '').toLocaleUpperCase('de-DE');
const pad2 = (n) => String(n).padStart(2, '0');

/** Mono-Zeile: „TDM · 6 GEGEN 6 · 40 ABSCHÜSSE · 10 MIN“. */
export function modeLine(m) {
  const parts = [m.short || up(m.id)];
  if (m.id === 'training') { parts.push('KEIN LIMIT'); return parts.join(' · '); }
  parts.push(m.teams ? `${(m.defaultAllies ?? 5) + 1} GEGEN ${m.defaultEnemies ?? 6}` : `${(m.defaultEnemies ?? 7) + 1} SPIELER`);
  if (m.scoreLimit) parts.push(`${m.scoreLimit} ${up(m.scoreUnit || '')}`.trim());
  parts.push(m.timeLimit ? `${Math.round(m.timeLimit / 60)} MIN` : 'OHNE ZEITLIMIT');
  return parts.join(' · ');
}

/* ------------------------------------------------------------------ Akte */

const ALLY = 'var(--np-ally)';
const ENEMY = 'var(--np-enemy)';
const lerp = (a, b, t) => a + (b - a) * t;
/** Stückweise Interpolation über Stützstellen [[ms, wert], …] (geglättet). */
function track(points, ms) {
  if (ms <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [t1, v1] = points[i];
    const [t0, v0] = points[i - 1];
    if (ms <= t1) return lerp(v0, v1, ease.inOut((ms - t0) / Math.max(1, t1 - t0)));
  }
  return points[points.length - 1][1];
}
const isSpace = (k, i) => k.glyphs[i]?.textContent === ' ' || k.glyphs[i]?.textContent === ' ';
function nearestGlyph(k, f) {
  let i = clamp(Math.round(f * (k.n - 1)), 0, k.n - 1);
  for (let d = 0; d < k.n; d++) {
    for (const j of [i - d, i + d]) if (j >= 0 && j < k.n && !isSpace(k, j)) return j;
  }
  return i;
}

function makeAct(id, row, D) {
  const k = row.kin;
  const n = k.n;
  const rw = () => row.restW();
  const rg = 700;
  const cleanup = () => {
    for (let i = 0; i < n; i++) { k.setOffset(i, 0, 0); k.set(i, { ty: 0, color: '', opacity: 1 }); }
    for (const s of row.name.querySelectorAll('.sup')) s.remove();
    if (row.count) row.count.textContent = '\u00a0';
  };

  if (id === 'tdm') {
    const mid = Math.floor(n / 2);
    return (ms) => {
      if (ms === Infinity || ms >= 1200) { cleanup(); return false; }
      const L = track([[0, 0], [260, 125 - rw()], [560, 62 - rw()], [860, 125 - rw()], [1160, 0]], ms);
      const R = track([[0, 0], [260, 62 - rw()], [560, 125 - rw()], [860, 62 - rw()], [1160, 0]], ms);
      const tint = ms < 1080;
      for (let i = 0; i < n; i++) {
        const left = i < mid;
        k.setOffset(i, left ? L : R, 0);
        k.set(i, { color: tint ? (left ? ALLY : ENEMY) : '' });
      }
      return true;
    };
  }

  if (id === 'dom') {
    const picks = [nearestGlyph(k, 1 / 6), nearestGlyph(k, 1 / 2), nearestGlyph(k, 5 / 6)];
    const uniq = [...new Set(picks)];
    let placed = false;
    return (ms) => {
      if (ms === Infinity || ms >= 1560) { cleanup(); return false; }
      if (!placed) {
        placed = true;
        uniq.forEach((gi, j) => {
          const sup = document.createElement('span');
          sup.className = 'sup';
          sup.textContent = 'ABC'[j];
          k.glyphs[gi].append(sup); // in der Glyphe, absolut gesetzt: verschiebt nichts
        });
      }
      uniq.forEach((gi, j) => {
        const t0 = 120 + j * 300;
        const p = clamp((ms - t0) / 240, 0, 1);
        const back = clamp((ms - 1320) / 240, 0, 1);
        const g = lerp(lerp(100 - rg, 900 - rg, ease.out(p)), 0, ease.inOut(back));
        k.setOffset(gi, 0, g);
        k.set(gi, { color: p >= 1 && back < 1 ? ALLY : '' });
      });
      return true;
    };
  }

  if (id === 'ffa') {
    const from = Array.from({ length: n }, () => ({ w: 0, y: 0 }));
    const to = Array.from({ length: n }, () => ({ w: 0, y: 0 }));
    let step = -1;
    return (ms) => {
      if (ms === Infinity || ms >= 1000) { cleanup(); return false; }
      const s = Math.floor(ms / 90);
      if (s !== step) {
        step = s;
        for (let i = 0; i < n; i++) {
          from[i] = { ...to[i] };
          to[i] = ms >= 900 ? { w: 0, y: 0 } : { w: 62 + Math.random() * 63 - rw(), y: (Math.random() * 2 - 1) * 0.04 };
        }
      }
      const p = ease.out(clamp((ms - step * 90) / 90, 0, 1));
      for (let i = 0; i < n; i++) {
        k.setOffset(i, lerp(from[i].w, to[i].w, p), 0);
        k.set(i, { ty: lerp(from[i].y, to[i].y, p) });
      }
      return true;
    };
  }

  if (id === 'gun') {
    const steps = D.W?.GUN_GAME_STEPS || [];
    const total = steps.length || 18;
    return (ms) => {
      if (ms === Infinity || ms >= total * 70 + 240) { cleanup(); return false; }
      const s = Math.min(total - 1, Math.floor(ms / 70));
      const g = ms >= total * 70 ? lerp(900 - rg, 0, ease.out((ms - total * 70) / 240)) : 100 + (800 * s) / Math.max(1, total - 1) - rg;
      for (let i = 0; i < n; i++) k.setOffset(i, 0, g);
      if (row.count) {
        const wid = steps[s];
        const name = D.W?.WEAPONS?.[wid]?.name || '';
        row.count.textContent = `${pad2(s + 1)}/${pad2(total)} ${name}`.trim();
      }
      return true;
    };
  }

  if (id === 'training') {
    const order = Array.from({ length: n }, (_, i) => i).filter((i) => !isSpace(k, i)).sort(() => Math.random() - 0.5);
    const popAt = new Map(order.map((i, j) => [i, 160 + j * 80]));
    const lastPop = 160 + (order.length - 1) * 80;
    const fallAt = (i) => lastPop + 600 + i * 40;
    const end = fallAt(n - 1) + 520;
    const popped = new Set();
    return (ms) => {
      if (ms === Infinity || ms >= end) { cleanup(); return false; }
      for (let i = 0; i < n; i++) {
        const drop = ease.out(clamp(ms / 150, 0, 1));
        const pa = popAt.get(i) ?? 0;
        const pop = ease.out(clamp((ms - pa) / 140, 0, 1));
        const fall = ease.in(clamp((ms - fallAt(i)) / 160, 0, 1));
        const rise = ease.out(clamp((ms - (end - 300)) / 280, 0, 1));
        const down = lerp(lerp(drop, 1 - pop, pop > 0 ? 1 : 0), 1, fall) * (1 - rise);
        k.set(i, { ty: 0.3 * down, opacity: 1 - 0.7 * down });
        k.setOffset(i, 0, (100 - rg) * down);
        if (pop >= 1 && !popped.has(i) && ms < fallAt(i)) { popped.add(i); k.impulse(i, 12, 120); }
      }
      return true;
    };
  }

  // Unbekannter Modus: eine schlichte Welle
  return (ms) => {
    if (ms === 0) k.wave(18, 260, { stagger: 24 });
    return ms < 900 && ms !== Infinity;
  };
}

/* ------------------------------------------------------------------ Ansicht */

export async function init(sec, D, ctx = {}) {
  const snd = ctx.sound;
  const list = $('#modes-list', sec);
  if (!list) return;
  const M = D.M;
  if (!D.ok.modes) { signalLost(list.parentNode, 'Die Moduldaten fehlen. Die Übersicht bleibt statisch.'); return; }
  const rows = [];
  let open = null;
  let acting = null;

  const ol = h('ol.modes');
  for (const id of M.MODE_ORDER) {
    const m = M.MODES[id];
    const bid = `mode-b-${id}`;
    const pid = `mode-p-${id}`;
    const name = h('span.mode-name', { 'data-fit': '', 'data-fit-grow': '0', 'data-fit-slots': '' }, m.name);
    const count = id === 'gun' ? h('span.mode-count', { 'aria-hidden': 'true' }, '\u00a0') : null;
    const line = h('span.mono-s.mode-line', {}, modeLine(m), count);
    const head = h('button.mode-head', { type: 'button', id: bid, 'aria-expanded': 'false', 'aria-controls': pid }, name, line);
    const recos = (m.recommendedMaps || []).map((mid) => D.P.MAPS[mid]?.name).filter(Boolean);
    const play = h('a.play-link', { href: '#', 'data-kill': '', 'data-mode': id }, `${m.name} spielen`, h('span.o', {}, '.'));
    const inner = h('div.mode-inner', {},
      m.tagline ? h('p.lead', {}, m.tagline) : null,
      m.description ? h('p.body', {}, m.description) : null,
      Array.isArray(m.rules) && m.rules.length ? h('ul.rules', {}, m.rules.map((r) => h('li', {}, r))) : null,
      recos.length ? h('p.recos', {}, `${recos.length > 1 ? 'Empfohlene Karten' : 'Empfohlene Karte'}: ${recos.join(', ')}`) : null,
      play);
    const panel = h('div.mode-panel', { id: pid, role: 'region', 'aria-labelledby': bid }, h('div', {}, inner));
    panel.inert = true;
    const li = h('li.mode', { 'data-id': id }, h('h3.mode-h', {}, head), panel);
    ol.append(li);
    split(name);
    const row = { id, m, li, head, name, panel, play, count, kin: null, armed: true };
    row.restW = () => Number(name.dataset.fitted) || 100;
    rows.push(row);
  }
  list.replaceWith(ol);
  ol.id = 'modes-list';
  // Alle Namen in einem Durchgang setzen (ein Lese-/Schreibzyklus statt fünf erzwungener Layouts)
  rows.forEach((r, i) => fit(r.name, { now: i === rows.length - 1 }));
  for (const r of rows) r.kin = new Kinetic(r.name);

  const linkFor = (r) => {
    if (r.id === 'training') return buildPlayUrl({ mode: 'training' });
    return buildPlayUrl({ mode: r.id, map: r.m.recommendedMaps?.[0], allies: r.m.defaultAllies, enemies: r.m.defaultEnemies });
  };
  const refreshLinks = () => { for (const r of rows) r.play.setAttribute('href', linkFor(r)); };
  refreshLinks();
  ui.onChange((k) => { if (k === 'diff' || k === 'map' || k === 'mode') refreshLinks(); });

  function act(r) {
    if (calm() || !r.kin) return;
    if (acting && acting !== r) acting.kin.reset();
    acting = r;
    r.kin.reset();
    r.kin.run(makeAct(r.id, r, D));
  }

  function setOpen(r, on) {
    r.li.classList.toggle('open', on);
    r.head.setAttribute('aria-expanded', String(on));
    r.panel.inert = !on;
  }
  function toggle(r) {
    const willOpen = open !== r;
    if (open) setOpen(open, false);
    open = willOpen ? r : null;
    if (willOpen) { setOpen(r, true); act(r); }
  }

  for (const r of rows) {
    r.head.addEventListener('click', () => { toggle(r); snd?.ui('click'); });
    r.head.addEventListener('focus', () => { if (r.head.matches(':focus-visible')) act(r); });
    r.head.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse' || !pointerFine()) return;
      act(r);
      snd?.ui('hover');
    });
    r.play.addEventListener('click', () => {
      rememberLaunch(r.play.href);
      snd?.ui('confirm');
    });
  }

  // Mitte des Bildschirms (20 %-Band): einmal pro Durchgang
  const band = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const r = rows.find((x) => x.head === e.target);
      if (!r) continue;
      if (e.isIntersecting) { if (r.armed) { r.armed = false; act(r); } }
      else r.armed = true;
    }
  }, { rootMargin: '-40% 0px -40% 0px' });
  for (const r of rows) band.observe(r.head);

  /* ---------------------------------------------------------------- SERIEN */
  // Eine Zählzeile statt einer Kachelreihe: „4 — Aufklärer. 6 — Präzisionsschlag. 8 — Wachgeschütz.“
  // Die Ziffern werden stärker, sobald die Zeile in die Bildmitte kommt (oder unter dem Zeiger liegt).
  const box = $('#streaks', sec);
  const notes = $('#streak-notes', sec);
  if (box && M.STREAK_ORDER?.length) {
    const items = M.STREAK_ORDER.map((sid) => M.STREAKS[sid]).filter(Boolean);
    const n = (x) => x.kills ?? x.cost ?? '';
    box.replaceChildren(...items.map((x) => h('li', {},
      h('span.sn', {}, String(n(x))), h('span.sdash', { 'aria-hidden': 'true' }, '\u00a0— '), h('span.snm', {}, `${x.name}.`),
      h('span.sr-only', {}, ` ${n(x)} Abschüsse ohne Tod.`))));
    notes?.replaceChildren(...items.map((x) => h('div', {}, h('dt', {}, `${n(x)} Abschüsse · ${x.name}`), h('dd', {}, x.description || ''))));
    if (reduced()) box.classList.add('lit');
    else {
      const lit = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        lit.disconnect();
        box.classList.add('lit');
      }, { rootMargin: '-35% 0px -35% 0px' });
      lit.observe(box);
    }
  }
}
