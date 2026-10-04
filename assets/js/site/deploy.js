// §01 Satzbau: Der Einsatz ist ein Satz. Jedes Wort ist eine native Auswahl.
// buildPlayUrl() ist der EINZIGE Erzeuger von Spiel-Links auf der Seite.
import { ui } from './state.js';
import { mapsForMode } from './data.js';
import { reduced } from './motion.js';
import { announce, debounced } from './live.js';

const $ = (s, r = document) => r.querySelector(s);
const NB = ' ';
let D = null;
let sound = null;

const PREP = { hafen: 'im', altstadt: 'in der', werk: 'im', range: 'am' };
/** Präposition vor dem Kartennamen. */
export function mapPrep(id) { return PREP[id] || 'auf'; }

function modeDef(id) { return D?.M?.MODES?.[id] || null; }
function clampInt(v, [a, b]) { return Math.max(a, Math.min(b, Math.round(Number(v) || 0))); }

/** Spiel-Link aus dem aktuellen Zustand plus Überschreibungen. */
export function buildPlayUrl(cfg = {}) {
  const st = ui.get();
  const mode = cfg.mode || st.mode || 'tdm';
  if (mode === 'training') return 'spielen.html?mode=training&map=range';
  const def = modeDef(mode);
  const same = mode === st.mode;
  const lim = def?.limits || { allies: [0, 7], enemies: [1, 11] };
  let allies = cfg.allies ?? (same ? st.allies : def?.defaultAllies ?? 5);
  let enemies = cfg.enemies ?? (same ? st.enemies : def?.defaultEnemies ?? 6);
  allies = def?.teams === false ? 0 : clampInt(allies, lim.allies);
  enemies = clampInt(enemies, lim.enemies);
  let map = cfg.map || st.map || 'hafen';
  if (D && !mapsForMode(D, mode).includes(map)) map = mapsForMode(D, mode)[0] || map;
  const diff = cfg.diff || st.diff || 'regulaer';
  const p = new URLSearchParams({ mode, map, diff, allies: String(allies), enemies: String(enemies) });
  return `spielen.html?${p.toString()}`;
}

function upper(s) { return String(s || '').toLocaleUpperCase('de-DE'); }

/** Alle Spielen-Links und die Konfigurationszeile im Hero aktualisieren. */
export function refreshPlayLinks() {
  const href = buildPlayUrl();
  for (const a of document.querySelectorAll('a[data-play]')) a.setAttribute('href', href);
  const st = ui.get();
  const m = modeDef(st.mode);
  const mapName = D?.P?.MAPS?.[st.map]?.name || st.map;
  const diff = D?.M?.DIFFICULTIES?.[st.diff]?.name || st.diff;
  const cfg = $('#cta-cfg');
  if (cfg) {
    cfg.textContent = st.mode === 'training'
      ? `${m?.short || 'TRN'} · AM ${upper(D?.P?.MAPS?.range?.name || 'Schießstand')}`
      : `${m?.short || upper(st.mode)} · ${upper(mapPrep(st.map))} ${upper(mapName)} · ${upper(diff)}`;
  }
  const url = $('#play-url');
  if (url) url.textContent = href;
}

/* ---------------------------------------------------------------- Satzbau */

function swap(el, text, animate = true) {
  if (!el || el.textContent === text) return;
  if (!animate || reduced()) { el.textContent = text; return; }
  el.classList.add('out');
  clearTimeout(el._swapT);
  el._swapT = setTimeout(() => {
    el.textContent = text;
    requestAnimationFrame(() => el.classList.remove('out'));
  }, 120);
}
function enterWord(el) {
  if (reduced()) return;
  el.style.transition = 'none';
  el.classList.add('out');
  void el.offsetWidth;
  el.style.transition = '';
  requestAnimationFrame(() => el.classList.remove('out'));
}

function option(value, label, selected) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  if (selected) o.selected = true;
  return o;
}

export function initDeploy(data, { snd, webgl } = {}) {
  D = data;
  sound = snd;
  const form = $('#satz');
  const p = $('.satz-text', form);
  if (!form || !p) return;
  const S = D.settings;

  // Anfangszustand aus den Einstellungen
  const order = D.M.MODE_ORDER;
  let mode = order.includes(S.get('lastMode')) ? S.get('lastMode') : (order.includes('tdm') ? 'tdm' : order[0]);
  const allowed = mapsForMode(D, mode);
  const lastMap = S.get('lastMap');
  const map = mode === 'training' ? 'range' : (allowed.includes(lastMap) ? lastMap : allowed[0]);
  const diff = D.M.DIFFICULTY_ORDER.includes(S.get('difficulty')) ? S.get('difficulty') : 'regulaer';
  const def = modeDef(mode);
  ui.patch({ mode, map, diff, allies: def?.defaultAllies ?? 5, enemies: def?.defaultEnemies ?? 6 });

  // Bausteine (einmal erzeugt, danach nur umgestellt – der Fokus bleibt erhalten)
  const mk = (cls, text) => { const s = document.createElement('span'); s.className = cls; s.textContent = text; return s; };
  const slots = {};
  for (const [key, label] of [['mode', 'Modus'], ['map', 'Karte'], ['allies', 'Verbündete'], ['enemies', 'Gegner'], ['diff', 'Stufe']]) {
    const l = document.createElement('label');
    l.className = 'slot';
    l.dataset.slot = key;
    const sr = mk('sr-only', label);
    const w = mk('word', '');
    w.setAttribute('aria-hidden', 'true');
    const sel = document.createElement('select');
    sel.name = key;
    l.append(sr, w, sel);
    slots[key] = { label: l, word: w, sel };
  }
  const words = {
    ich: mk('w', 'Ich'), lead: mk('w', 'spiele'), prep: mk('w prep', 'im'), mit: mk('w', 'mit'),
    verb: mk('w', 'Verbündeten'), gegen: mk('w', 'gegen'), bots: mk('w', 'Bots'), auf: mk('w', 'auf'),
    dot: mk('w', '.'),
  };
  const go = $('#go', form) || document.createElement('a');
  go.classList.add('go');
  let layout = '';

  function fillSelects() {
    const st = ui.get();
    const m = modeDef(st.mode);
    const s = slots.mode.sel;
    if (!s.options.length) for (const id of order) s.appendChild(option(id, D.M.MODES[id].name, id === st.mode));
    s.value = st.mode;
    const maps = st.mode === 'training' ? ['range'] : mapsForMode(D, st.mode);
    slots.map.sel.replaceChildren(...maps.map((id) => option(id, D.P.MAPS[id]?.name || id, id === st.map)));
    const la = m?.limits?.allies || [0, 7];
    const le = m?.limits?.enemies || [1, 8];
    slots.allies.sel.replaceChildren(...Array.from({ length: la[1] - la[0] + 1 }, (_, i) => option(String(la[0] + i), String(la[0] + i), la[0] + i === st.allies)));
    slots.enemies.sel.replaceChildren(...Array.from({ length: le[1] - le[0] + 1 }, (_, i) => option(String(le[0] + i), String(le[0] + i), le[0] + i === st.enemies)));
    if (!slots.diff.sel.options.length) for (const id of D.M.DIFFICULTY_ORDER) slots.diff.sel.appendChild(option(id, D.M.DIFFICULTIES[id].name, id === st.diff));
    slots.diff.sel.value = st.diff;
  }

  function arrange(animate) {
    const st = ui.get();
    const m = modeDef(st.mode);
    const kind = st.mode === 'training' ? 'training' : (m?.teams === false ? 'solo' : 'teams');
    const changed = kind !== layout;
    if (!changed) return false;
    layout = kind;
    // Alles vor dem Modus-Slot steht fest, danach wird neu gesetzt
    if (!p.contains(slots.mode.label) || p.firstChild !== words.ich) {
      p.replaceChildren(words.ich, document.createTextNode(' '), words.lead, document.createTextNode(NB), slots.mode.label);
    }
    while (slots.mode.label.nextSibling) slots.mode.label.nextSibling.remove();
    const sp = () => document.createTextNode(' ');
    const nb = () => document.createTextNode(NB);
    const seq = [];
    if (kind === 'training') {
      seq.push(words.dot);
    } else {
      seq.push(sp(), words.prep, nb(), slots.map.label);
      if (kind === 'teams') seq.push(sp(), words.mit, nb(), slots.allies.label, nb(), words.verb);
      seq.push(sp(), words.gegen, nb(), slots.enemies.label, nb(), words.bots, sp(), words.auf, nb(), slots.diff.label, words.dot);
    }
    seq.push(sp(), go);
    p.append(...seq);
    swap(words.lead, kind === 'training' ? 'gehe an den' : 'spiele', animate);
    if (animate && changed) for (const k of ['map', 'allies', 'enemies', 'diff']) if (p.contains(slots[k].label)) enterWord(slots[k].word);
    return true;
  }

  function render(animate = true, focusKey = null) {
    const st = ui.get();
    arrange(animate);
    fillSelects();
    const m = modeDef(st.mode);
    const set = (k, text) => swap(slots[k].word, text, animate && k !== focusKey ? animate : animate);
    set('mode', m?.name || st.mode);
    set('map', D.P.MAPS[st.map]?.name || st.map);
    set('allies', String(st.allies));
    set('enemies', String(st.enemies));
    set('diff', D.M.DIFFICULTIES[st.diff]?.name || st.diff);
    swap(words.prep, mapPrep(st.map), animate);
    swap(words.bots, st.enemies === 1 ? 'Bot' : 'Bots', animate);
    refreshPlayLinks();
  }

  const say = debounced(400);
  function summary() {
    const st = ui.get();
    const m = modeDef(st.mode);
    if (st.mode === 'training') return `Einsatz: ${m?.name || 'Schießstand'}.`;
    const mapName = D.P.MAPS[st.map]?.name || st.map;
    const parts = [`${m?.name || st.mode} ${mapPrep(st.map)} ${mapName}`];
    if (m?.teams !== false) parts.push(`${st.allies} Verbündete`);
    parts.push(`${st.enemies} ${st.enemies === 1 ? 'Bot' : 'Bots'}`);
    parts.push(D.M.DIFFICULTIES[st.diff]?.name || st.diff);
    return `Einsatz: ${parts.join(', ')}.`;
  }

  function persist() {
    const st = ui.get();
    S.patch({ lastMode: st.mode, lastMap: st.map, difficulty: st.diff });
  }

  form.addEventListener('change', (e) => {
    const sel = e.target;
    if (!(sel instanceof HTMLSelectElement)) return;
    const key = sel.name;
    const v = sel.value;
    const st = ui.get();
    if (key === 'mode') {
      const md = modeDef(v);
      const maps = v === 'training' ? ['range'] : mapsForMode(D, v);
      const nextMap = maps.includes(st.map) ? st.map : (maps.includes(S.get('lastMap')) ? S.get('lastMap') : maps[0]);
      ui.patch({ mode: v, map: nextMap, allies: md?.defaultAllies ?? 0, enemies: md?.defaultEnemies ?? 0 });
    } else if (key === 'allies' || key === 'enemies') {
      ui.set(key, Number(v));
    } else {
      ui.set(key, v);
    }
    persist();
    render(true, key);
    sound?.ui('click');
    say(summary());
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  go.addEventListener('click', () => sound?.ui('confirm'));
  for (const a of document.querySelectorAll('.cta-fill, .st-play, .bar-play')) a.addEventListener('click', () => sound?.ui('confirm'));

  // Link kopieren
  const copy = $('#copy-url');
  copy?.addEventListener('click', async () => {
    const abs = new URL(buildPlayUrl(), location.href).href;
    let ok = false;
    try { await navigator.clipboard.writeText(abs); ok = true; } catch {
      const ta = document.createElement('textarea');
      ta.value = abs;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;opacity:0;left:0;top:0';
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    copy.textContent = ok ? 'Kopiert.' : 'Kopieren nicht möglich.';
    announce(copy.textContent, { now: true });
    clearTimeout(copy._t);
    copy._t = setTimeout(() => { copy.textContent = 'Link kopieren'; }, 2000);
  });

  // Hinweise
  if (window.matchMedia('(pointer: coarse)').matches) $('#note-touch').hidden = false;
  if (!webgl) $('#note-webgl').hidden = false;

  // Externe Änderungen (anderer Tab, Spiel) übernehmen
  S.onChange((k, v) => {
    const st = ui.get();
    if (k === 'difficulty' && v !== st.diff && D.M.DIFFICULTY_ORDER.includes(v)) { ui.set('diff', v); render(true); }
    if (k === 'lastMode' && v !== st.mode && order.includes(v)) {
      const md = modeDef(v);
      const maps = v === 'training' ? ['range'] : mapsForMode(D, v);
      ui.patch({ mode: v, map: maps.includes(st.map) ? st.map : maps[0], allies: md?.defaultAllies ?? 0, enemies: md?.defaultEnemies ?? 0 });
      render(true);
    }
    if (k === 'lastMap' && v !== ui.get('map')) {
      const maps = ui.get('mode') === 'training' ? ['range'] : mapsForMode(D, ui.get('mode'));
      if (maps.includes(v)) { ui.set('map', v); render(true); }
    }
  });

  render(false);
}
