// §03 Karten: Sichtlinien-Satz. Jede Karte ist ein maßstäblicher Plan aus Wörtern; der Zeiger
// (oder Finger) ist ein Operator – was er sieht, steht fett, alles hinter Deckung fällt zur Haarlinie.
import { h, $, signalLost, tabs } from './dom.js';
import { buildPlayUrl } from './deploy.js';
import { makeBallistics } from './ballistics.js';
import { ui } from './state.js';
import { announce } from './live.js';
import { loop } from './loop.js';
import { reduced, pointerFine } from './motion.js';
import { num, NNBSP } from './fmt.js';
import { segmentsFrom, castVisibility, boundsOf, wordFor, corners, blocked, defaultPoint, planText, polyPath, isSoft } from './plan.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const up = (s) => String(s ?? '').toLocaleUpperCase('de-DE');
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  return el;
};
const idle = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 600 }) : setTimeout(fn, 60));
let uid = 0;

/** Baut den SVG-Plan einer Karte (einmal pro Karte, danach wiederverwendet). */
function buildPlan(map) {
  const blocks = map.blocks;
  const bounds = boundsOf(blocks, 4);
  const geo = segmentsFrom(blocks);
  const id = `vis-${map.id}-${++uid}`;
  const root = svg('svg', {
    class: 'plan', viewBox: `${bounds.x0.toFixed(2)} ${bounds.z0.toFixed(2)} ${bounds.w.toFixed(2)} ${bounds.h.toFixed(2)}`,
    role: 'img', 'aria-label': `Kartenplan ${map.name}`, preserveAspectRatio: 'xMidYMid meet',
  });
  const defs = svg('defs');
  const clip = svg('clipPath', { id, clipPathUnits: 'userSpaceOnUse' });
  const clipPath = svg('path', { d: '' });
  clip.append(clipPath);
  defs.append(clip);
  const frame = svg('rect', { class: 'bounds', x: bounds.x0, y: bounds.z0, width: bounds.w, height: bounds.h });
  const fill = svg('path', { class: 'vis-fill', d: '' });
  const rects = svg('g', { class: 'rects' });
  // Feste Deckung: ein Wort pro Block, das fett wird, sobald eine Kante sichtbar ist.
  // Weiche Flächen (Wasser, Bahnen …): zwei Ebenen, die fette per Sichtpolygon beschnitten.
  const solidG = svg('g', { class: 'words solid' });
  const dim = svg('g', { class: 'words dim' });
  const lit = svg('g', { class: 'words lit', 'clip-path': `url(#${id})` });
  const texts = [];
  const solidIdx = new Map(geo.solid.map((b, i) => [b, i]));
  for (const b of blocks) {
    const c = corners(b);
    rects.append(svg('path', { class: `blk${isSoft(b.kind) ? ' soft' : ''}`, d: `M${c.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('L')}Z` }));
    const short = Math.min(b.w, b.d);
    if (short < 1.2) continue;
    const along = b.d > 1.6 * b.w;
    const long = along ? b.d : b.w;
    const fs = 0.62 * short;
    const deg = ((b.rot || 0) * 180) / Math.PI + (along ? 90 : 0);
    const w = wordFor(b.kind);
    const attrs = { x: b.x.toFixed(2), y: b.z.toFixed(2), 'font-size': fs.toFixed(2), transform: deg ? `rotate(${deg.toFixed(2)} ${b.x.toFixed(2)} ${b.z.toFixed(2)})` : null };
    if (solidIdx.has(b)) {
      const t = svg('text', { ...attrs, class: 'w' });
      t.textContent = w.word;
      solidG.append(t);
      texts.push({ dim: t, lit: null, word: w.word, avail: long * 0.88, solid: solidIdx.get(b) });
      continue;
    }
    const tDim = svg('text', attrs);
    tDim.textContent = w.word;
    const tLit = svg('text', attrs);
    tLit.textContent = w.word;
    dim.append(tDim);
    lit.append(tLit);
    texts.push({ dim: tDim, lit: tLit, word: w.word, avail: long * 0.88 });
  }
  // Flaggen (Herrschaft), falls die Daten sie liefern
  const flags = svg('g', { class: 'flags' });
  for (const [i, f] of (Array.isArray(map.flags) ? map.flags : []).entries()) {
    const fx = Array.isArray(f) ? f[0] : f?.x;
    const fz = Array.isArray(f) ? f[1] : (f?.z ?? f?.y);
    if (!Number.isFinite(fx) || !Number.isFinite(fz)) continue;
    const t = svg('text', { x: fx, y: fz, 'font-size': 3.2 });
    t.textContent = (Array.isArray(f) ? null : f.id) || 'ABC'[i] || '';
    flags.append(t);
  }
  root.append(defs, frame, fill, rects, dim, lit, solidG, flags);
  return { root, bounds, geo, clipPath, fill, texts, solidTexts: texts.filter((t) => t.solid !== undefined), words: [dim, lit, solidG], measured: false };
}

/** Schriftbreite jedes Worts aus zwei Messungen (62 und 125) lösen; im Leerlauf, gebündelt. */
function measure(plan) {
  if (plan.measured || !plan.root.isConnected) return;
  plan.measured = true;
  const T = plan.texts;
  // Gemessen wird im fetten Schnitt (breitester Fall), damit das Wort auch beleuchtet in seinen Block passt.
  plan.root.classList.add('measuring');
  for (const t of T) t.dim.style.fontStretch = '62%';
  const l62 = T.map((t) => { try { return t.dim.getComputedTextLength(); } catch { return 0; } });
  for (const t of T) t.dim.style.fontStretch = '125%';
  const l125 = T.map((t) => { try { return t.dim.getComputedTextLength(); } catch { return 0; } });
  const abbr = [];
  T.forEach((t, i) => {
    if (!l62[i]) { t.wd = 100; return; }
    if (l62[i] <= t.avail) {
      const span = Math.max(1e-3, l125[i] - l62[i]);
      t.wd = Math.max(62, Math.min(125, 62 + (63 * (t.avail - l62[i])) / span));
    } else {
      t.wd = 62;
      if (t.word.length > 4) { t.short = `${t.word.slice(0, 3)}.`; abbr.push(t); } else t.hide = true;
    }
  });
  for (const t of abbr) { t.dim.textContent = t.short; t.dim.style.fontStretch = '62%'; }
  const la = abbr.map((t) => { try { return t.dim.getComputedTextLength(); } catch { return 0; } });
  abbr.forEach((t, i) => { if (la[i] > t.avail) t.hide = true; });
  plan.root.classList.remove('measuring');
  for (const t of T) {
    for (const el of [t.dim, t.lit]) {
      if (!el) continue;
      if (t.short) el.textContent = t.short;
      el.style.fontStretch = `${t.wd.toFixed(1)}%`;
      if (t.hide) el.setAttribute('visibility', 'hidden');
    }
  }
}

export async function init(sec, D, ctx = {}) {
  const root = $('#maps-root', sec);
  if (!root) return;
  if (!D.ok.maps) { signalLost(root, 'Kartenmaterial fehlt.'); return; }
  const { MAPS, MAP_ORDER } = D.P;
  const S = D.settings;
  const snd = ctx.sound;
  const B = D.W ? makeBallistics(D.W) : null;
  const ids = MAP_ORDER.filter((id) => MAPS[id]);

  /* ------------------------------------------------------------ Reiter */
  const list = h('div.tabs.map-tabs');
  const tabEls = {};
  for (const id of ids) {
    const t = h('button.tab', { type: 'button', role: 'tab', id: `map-tab-${id}`, 'aria-controls': 'map-panel', 'aria-selected': 'false', tabindex: '-1' }, MAPS[id].name);
    tabEls[id] = t;
    list.append(t);
  }

  /* ------------------------------------------------------------ Feld */
  const name = h('h3.map-name');
  const subtitle = h('p.map-sub');
  const desc = h('p.map-desc');
  const facts = h('p.map-facts');
  const palette = h('p.palette', { 'aria-hidden': 'true' });
  const rFree = h('p.big');
  const rTyp = h('p');
  const rFirst = h('p.first');
  const readouts = h('div.readouts', {}, rFree, rTyp, rFirst);
  const checkBtn = h('button.txt-btn', { type: 'button' }, 'Im Arsenal prüfen.');
  const playLink = h('a.play-link', { href: '#', 'data-kill': '' }, 'Hier spielen', h('span.o', {}, '.'));
  const links = h('div.map-links', {}, playLink, checkBtn);
  const scaleBar = h('i');
  const scale = h('p.scale', { 'aria-hidden': 'true' }, scaleBar, h('span', {}, `10${NNBSP}m`));
  const info = h('div.r.map-info', {}, h('div', {}, name, subtitle), readouts, links, desc, facts, palette, scale);

  const planWrap = h('div.plan-wrap', { tabindex: '0', role: 'group' });
  const opHit = h('span.op-hit', { 'aria-hidden': 'true' }, h('i.op-dot'));
  const textId = `plan-text-${++uid}`;
  const textP = h('p', { id: textId });
  const details = h('details.plan-text', {}, h('summary', {}, 'Plan als Text'), textP);
  const empty = h('div.plan-empty', { hidden: true });
  const planCol = h('div.m.map-plan', {}, planWrap, empty, details);
  const panel = h('div.span.maps-panel', { id: 'map-panel', role: 'tabpanel', 'aria-labelledby': `map-tab-${ids[0]}` }, info, planCol);

  root.replaceChildren(list);
  sec.append(panel);

  /* ------------------------------------------------------------ Zustand */
  const plans = new Map();
  let cur = null; // { id, map, plan }
  let op = { x: 0, z: 0 };
  let castQueued = false;
  let lastCast = null;
  let speak = false;

  const fmtInt = (v) => num(v);
  const toMap = (clientX, clientY) => {
    const r = cur.plan.root.getBoundingClientRect();
    const b = cur.plan.bounds;
    // viewBox mit „meet“: Seitenverhältnis bleibt, Plan füllt die Breite
    const s = Math.min(r.width / b.w, r.height / b.h) || 1;
    const ox = r.left + (r.width - b.w * s) / 2;
    const oy = r.top + (r.height - b.h * s) / 2;
    return { x: b.x0 + (clientX - ox) / s, z: b.z0 + (clientY - oy) / s };
  };

  function placeOp() {
    const b = cur.plan.bounds;
    opHit.style.left = `${(((op.x - b.x0) / b.w) * 100).toFixed(3)}%`;
    opHit.style.top = `${(((op.z - b.z0) / b.h) * 100).toFixed(3)}%`;
  }

  function cast() {
    castQueued = false;
    if (!cur?.plan) return false;
    const p = cur.plan;
    const res = castVisibility(p.geo, op, p.bounds);
    lastCast = res;
    const d = polyPath(res.poly);
    p.clipPath.setAttribute('d', d);
    p.fill.setAttribute('d', d);
    for (const t of p.solidTexts) {
      const on = res.seen.has(t.solid);
      if (t.on !== on) { t.on = on; t.dim.classList.toggle('on', on); }
    }
    const free = Math.round(res.maxDist);
    const typ = Math.round(res.medianDist);
    rFree.textContent = `Freie Sicht bis ${free}${NNBSP}m.`;
    rTyp.textContent = `Typische Distanz: ${typ}${NNBSP}m.`;
    const best = B ? B.rankAt(typ, 'body', { slot: 'primary' }).find((r) => Number.isFinite(r.ms)) : null;
    rFirst.textContent = best ? `Erste Wahl dort: ${best.def.name}.` : '';
    checkBtn.hidden = !B;
    if (speak) { speak = false; announce(`${rFree.textContent} ${rTyp.textContent} ${rFirst.textContent}`.trim()); }
    return false;
  }
  function queueCast(say = false) {
    if (say) speak = true;
    placeOp();
    if (!castQueued) { castQueued = true; loop.add(cast); }
  }

  function moveTo(x, z, { say = false, snap = false } = {}) {
    if (!cur?.plan) return false;
    const b = cur.plan.bounds;
    x = Math.max(b.x0 + 2.2, Math.min(b.x1 - 2.2, x));
    z = Math.max(b.z0 + 2.2, Math.min(b.z1 - 2.2, z));
    const solid = cur.plan.geo.solid;
    if (blocked(solid, x, z, 0.4)) {
      if (!snap) return false;
      // nächster freier Punkt im Umkreis von 4 m
      let best = null;
      let bd = Infinity;
      for (let r = 0.5; r <= 4 && !best; r += 0.5) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
          const px = x + Math.cos(a) * r;
          const pz = z + Math.sin(a) * r;
          if (!blocked(solid, px, pz, 0.4) && r < bd) { best = { x: px, z: pz }; bd = r; }
        }
      }
      if (!best) return false;
      ({ x, z } = best);
    }
    op = { x, z };
    queueCast(say);
    return true;
  }

  function showMap(id, user = false) {
    const map = MAPS[id];
    if (!map) return;
    const prev = cur;
    ui.set('mapTab', id);
    name.textContent = map.name;
    subtitle.textContent = map.subtitle || '';
    subtitle.hidden = !map.subtitle;
    desc.textContent = map.description || map.short || '';
    const modeShorts = (map.modes || []).map((m) => D.M.MODES[m]?.short || up(m)).join(', ');
    facts.textContent = [map.timeOfDay && `TAGESZEIT ${up(map.timeOfDay)}`, map.size && `GRÖSSE ${up(map.size)}`, modeShorts && `MODI ${modeShorts}`].filter(Boolean).join(' · ');
    palette.replaceChildren(...(map.palette || []).map((c) => h('i', { style: { background: /^#[0-9a-f]{3,8}$/i.test(c) ? c : 'transparent' } })));
    panel.setAttribute('aria-labelledby', `map-tab-${id}`);
    refreshPlay(id);

    const hasPlan = Array.isArray(map.blocks) && map.blocks.length > 0;
    let plan = null;
    if (hasPlan) {
      plan = plans.get(id);
      if (!plan) { plan = buildPlan(map); plans.set(id, plan); }
    }
    const swap = () => {
      cur = { id, map, plan };
      planWrap.hidden = !plan;
      details.hidden = !plan;
      readouts.hidden = !plan;
      checkBtn.hidden = !plan || !B;
      scale.hidden = !plan;
      empty.hidden = !!plan;
      if (!plan) {
        empty.replaceChildren(h('div.err-state', { html: '<strong>KEIN SIGNAL.</strong>Für diese Karte liegt noch kein vermessener Plan vor.' }));
        return;
      }
      planWrap.replaceChildren(plan.root, opHit);
      planWrap.style.setProperty('--ar', (plan.bounds.w / plan.bounds.h).toFixed(4));
      planWrap.setAttribute('aria-label', `Kartenplan ${map.name}. Pfeiltasten bewegen, Umschalt für 5 Meter.`);
      plan.root.setAttribute('aria-describedby', textId);
      textP.textContent = planText(map.name, map.blocks, plan.bounds, fmtInt);
      const start = defaultPoint(map.blocks, plan.geo.solid, plan.bounds);
      op = start;
      placeScale();
      queueCast(false);
      if (!plan.measured) idle(() => measure(plan));
      if (user && !reduced()) {
        plan.root.classList.add('switching');
        requestAnimationFrame(() => requestAnimationFrame(() => plan.root.classList.remove('switching')));
      }
    };
    if (user && prev?.plan && !reduced()) {
      prev.plan.root.classList.add('switching');
      setTimeout(swap, 240);
    } else swap();
  }

  function placeScale() {
    if (!cur?.plan) return;
    const r = cur.plan.root.getBoundingClientRect();
    const b = cur.plan.bounds;
    const s = Math.min(r.width / b.w, (r.height || r.width) / b.h) || r.width / b.w;
    scaleBar.style.width = `${(10 * s).toFixed(1)}px`;
  }

  function refreshPlay(id = cur?.id) {
    const map = MAPS[id];
    if (!map) return;
    let href;
    if (id === 'range' || (map.modes || []).includes('training') && !(map.modes || []).some((m) => m !== 'training')) href = buildPlayUrl({ mode: 'training' });
    else {
      const mode = (map.modes || []).includes(ui.get('mode')) ? ui.get('mode') : (map.modes?.[0] || 'tdm');
      href = buildPlayUrl({ mode, map: id });
    }
    playLink.setAttribute('href', href);
  }

  /* ------------------------------------------------------------ Eingabe */
  planWrap.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !cur?.plan || drag) return;
    const p = toMap(e.clientX, e.clientY);
    moveTo(p.x, p.z);
  });
  planWrap.addEventListener('click', (e) => {
    if (!cur?.plan || e.target.closest('.op-hit')) return;
    if (e.pointerType === 'mouse' || (pointerFine() && e.detail > 0 && !e.pointerType)) return;
    const p = toMap(e.clientX, e.clientY);
    if (moveTo(p.x, p.z, { say: true, snap: true })) snd?.ui('click');
  });
  let drag = null;
  opHit.addEventListener('pointerdown', (e) => {
    if (!cur?.plan) return;
    drag = { id: e.pointerId };
    opHit.setPointerCapture?.(e.pointerId);
    opHit.classList.add('grab');
    e.preventDefault();
  });
  opHit.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = toMap(e.clientX, e.clientY);
    moveTo(p.x, p.z);
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    opHit.classList.remove('grab');
    queueCast(true);
  };
  opHit.addEventListener('pointerup', endDrag);
  opHit.addEventListener('pointercancel', endDrag);
  planWrap.addEventListener('keydown', (e) => {
    if (e.target !== planWrap || !cur?.plan) return;
    const step = e.shiftKey ? 5 : 1;
    const dx = { ArrowLeft: -step, ArrowRight: step }[e.key] || 0;
    const dz = { ArrowUp: -step, ArrowDown: step }[e.key] || 0;
    if (!dx && !dz) return;
    e.preventDefault();
    // In kleinen Schritten gehen, damit der Operator an Deckung stehen bleibt
    const n = Math.ceil(step / 0.5);
    let moved = false;
    for (let i = 0; i < n; i++) {
      if (!moveTo(op.x + (dx / n), op.z + (dz / n))) break;
      moved = true;
    }
    if (moved) speak = true;
  });

  checkBtn.addEventListener('click', async () => {
    if (!lastCast) return;
    ui.set('distance', Math.max(0, Math.min(100, Math.round(lastCast.medianDist))));
    snd?.ui('click');
    await ctx.ensure?.('arsenal');
    const target = document.getElementById('auf-distanz') || document.getElementById('arsenal');
    target?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    target?.focus?.({ preventScroll: true });
  });
  playLink.addEventListener('click', () => {
    const u = new URL(playLink.href, location.href).searchParams;
    S.patch({ lastMode: u.get('mode') || undefined, lastMap: u.get('map') || undefined });
    snd?.ui('confirm');
  });
  ui.onChange((k) => { if (k === 'mode' || k === 'diff' || k === 'map') refreshPlay(); });

  if ('ResizeObserver' in window) {
    let rs = 0;
    new ResizeObserver(() => { cancelAnimationFrame(rs); rs = requestAnimationFrame(placeScale); }).observe(planWrap);
  }

  /* ------------------------------------------------------------ Start */
  const T = tabs(list, {
    label: 'Karten',
    onSelect: (tab, user) => {
      const id = tab.id.replace('map-tab-', '');
      if (cur?.id === id) return;
      showMap(id, user);
      if (user) snd?.ui('click');
    },
  });
  const first = ids.includes(S.get('lastMap')) ? S.get('lastMap') : ids[0];
  T.select(tabEls[first], false);
}
