// Statuszeile, Index (Scroll-Spy aus Schrift), Index-Dialog, untere Leiste, Spielen-Umschaltung,
// Visierlinie und Überschriften (Eintritt + Stauchung bei schnellem Scrollen).
import { loop } from './loop.js';
import { reduced, calm } from './motion.js';
import { split } from './kinetic.js';
import { jumpTo } from './jump.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const SECTIONS = ['einsatz', 'modi', 'karten', 'arsenal', 'profil', 'einstellungen', 'steuerung', 'ueber'];
const NAMES = { nullpunkt: 'Nullpunkt', einsatz: 'Einsatz', modi: 'Modi', karten: 'Karten', arsenal: 'Arsenal', profil: 'Profil', einstellungen: 'Einstellungen', steuerung: 'Steuerung', ueber: 'Über' };

let scrollLoop = false;
let lastScrollY = window.scrollY;
let lastScrollT = performance.now();
let sv = 0;
let svTarget = 0;
let idleFrames = 0;
const visibleH2 = new Set();
let current = '';
let sound = null;

export function setNavSound(s) { sound = s; }

function axis() {
  const sec = $('#einsatz');
  const rail = sec && $('.rail', sec);
  const content = sec && $('.content', sec);
  if (!rail || !content) return;
  const r = rail.getBoundingClientRect();
  const c = content.getBoundingClientRect();
  const root = document.documentElement.style;
  if (c.left - r.right > 2) {
    root.setProperty('--axis-x', `${((r.right + c.left) / 2).toFixed(1)}px`);
  }
  root.setProperty('--rail-w', `${r.width.toFixed(1)}px`);
}

function spy() {
  const vh = window.innerHeight;
  const mid = vh / 2;
  let best = null;
  let bestP = -1;
  const links = $$('.index a');
  const ps = {};
  for (const id of ['nullpunkt', ...SECTIONS]) {
    const s = document.getElementById(id);
    if (!s) continue;
    const r = s.getBoundingClientRect();
    // Nähe zur Bildschirmmitte: Mitte des Abschnitts, aber mindestens innerhalb seiner Kanten
    const center = Math.min(Math.max(mid, r.top), r.bottom);
    const p = 1 - Math.min(1, Math.max(0, Math.abs(center - mid) / vh));
    ps[id] = p;
    if (p > bestP) { bestP = p; best = id; }
  }
  for (const a of links) {
    const id = a.getAttribute('href').slice(1);
    const p = ps[id] ?? 0;
    a.style.setProperty('--p', p.toFixed(3));
    if (id === best) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    a.parentElement?.classList.toggle('cur', id === best);
  }
  for (const a of $$('.dlg-list a')) {
    if (a.getAttribute('href').slice(1) === best) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
  }
  if (best && best !== current) {
    current = best;
    const name = $('#bar-name');
    if (name) {
      name.classList.add('swap');
      name.textContent = NAMES[best] || best;
      if (!reduced()) requestAnimationFrame(() => requestAnimationFrame(() => name.classList.remove('swap')));
      else name.classList.remove('swap');
    }
  }
}

function scrollTick(dt) {
  const y = window.scrollY;
  const t = performance.now();
  const ddt = Math.max(1, t - lastScrollT);
  const v = Math.abs(y - lastScrollY) / ddt; // px/ms
  lastScrollY = y;
  lastScrollT = t;
  svTarget = calm() ? 0 : Math.min(1, v / 4);
  // Tiefpass τ 120 ms beim Anziehen, Rückfederung über ~640 ms
  const tau = svTarget > sv ? 0.12 : 0.2;
  sv += (svTarget - sv) * (1 - Math.exp(-dt / tau));
  if (sv < 0.004) sv = 0;
  for (const h of visibleH2) h.style.setProperty('--sv', sv.toFixed(3));
  spy();
  $('#status')?.classList.toggle('scrolled', y > 8);
  if (v < 0.01) idleFrames++; else idleFrames = 0;
  if (idleFrames > 6 && sv === 0) { scrollLoop = false; return false; }
  return true;
}

function onScroll() {
  if (!scrollLoop) {
    scrollLoop = true;
    idleFrames = 0;
    lastScrollT = performance.now();
    loop.add(scrollTick);
  }
}

function initHeadlines() {
  const heads = $$('.hl');
  for (const h of heads) {
    split(h);
    if (!reduced()) h.classList.add('pre');
  }
  const enter = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const h = e.target;
      enter.unobserve(h);
      if (!h.classList.contains('pre')) continue;
      if (reduced()) { h.classList.remove('pre'); continue; }
      h.classList.add('entering');
      requestAnimationFrame(() => h.classList.remove('pre'));
      const n = h.querySelectorAll('.g').length;
      setTimeout(() => h.classList.remove('entering'), 700 + n * 24);
    }
  }, { threshold: 0.15 });
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) visibleH2.add(e.target);
      else { visibleH2.delete(e.target); e.target.style.removeProperty('--sv'); }
    }
  });
  for (const h of heads) { enter.observe(h); seen.observe(h); }
}

function initDialog() {
  const dlg = $('#index-dialog');
  if (!dlg || typeof dlg.showModal !== 'function') return;
  let trigger = null;
  for (const b of $$('[data-open-index]')) {
    b.addEventListener('click', () => {
      trigger = b;
      dlg.showModal();
      sound?.ui('click');
    });
  }
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
    const a = e.target.closest?.('a[href^="#"]');
    if (a) {
      e.preventDefault();
      e.stopPropagation();
      const id = a.getAttribute('href').slice(1);
      trigger = null;
      dlg.close();
      jumpTo(id);
    }
  });
  $('[data-close]', dlg)?.addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => { sound?.ui('back'); trigger?.focus(); });
}

export function initNav() {
  initHeadlines();
  initDialog();
  axis();
  spy();
  $('#status')?.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  let rs = 0;
  window.addEventListener('resize', () => { cancelAnimationFrame(rs); rs = requestAnimationFrame(() => { axis(); spy(); }); });
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => { cancelAnimationFrame(rs); rs = requestAnimationFrame(() => { axis(); spy(); }); });
    ro.observe(document.body);
  }

  // Spielen.-Knopf in Statuszeile/unterer Leiste erst, wenn der Hero-CTA nicht mehr sichtbar ist
  const cta = $('.hero-cta');
  const stPlay = $('.st-play');
  const bar = $('#bar');
  if (cta) {
    const io = new IntersectionObserver(([e]) => {
      const away = !e.isIntersecting;
      if (stPlay) stPlay.hidden = !away;
      document.body.classList.toggle('past-hero', away);
      if (bar) {
        bar.hidden = !away;
        document.body.classList.toggle('bar-on', away);
      }
    });
    io.observe(cta);
  }
}

export { NAMES as SECTION_NAMES };
