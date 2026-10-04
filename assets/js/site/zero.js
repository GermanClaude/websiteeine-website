// §00 Einschießen: Fünf Schuss auf den orangefarbenen Punkt. Löcher im Papier, Glyphen-Kick,
// Streukreis in mm, Treffpunktlage in Klick – danach gleitet der Nullpunkt unter die Gruppe.
import { Kinetic, split } from './kinetic.js';
import { glyphModel } from './fit.js';
import { spread, hit } from './cursor.js';
import { site } from './state.js';
import { announce } from './live.js';
import { reduced, SPRINGS } from './motion.js';
import { num, NNBSP } from './fmt.js';

const $ = (s) => document.querySelector(s);
const CLICK_PX = 8;
const MAX_SHOTS = 5;

let dotRatio = 0.13; // Höhe des Punkts in em (aus der Schrift gemessen)
function measureDot() {
  try {
    const c = document.createElement('canvas').getContext('2d');
    c.font = '800 100px "Archivo NP"';
    const m = c.measureText('.');
    if (m.actualBoundingBoxAscent > 0) dotRatio = (m.actualBoundingBoxAscent + Math.max(0, m.actualBoundingBoxDescent)) / 100;
  } catch { /* Standardwert */ }
}

export function initZero({ sound } = {}) {
  const target = $('#target');
  const h1 = $('#h-null');
  const bull = $('#bull');
  const holesEl = $('#holes');
  const msg = $('#zero-msg');
  const resetBtn = $('#zero-reset');
  const bestEl = $('#zero-best');
  if (!target || !h1) return null;

  split(h1, { sr: 'NULLPUNKT' });
  // Obergrenze auch aus der Höhe: Im Querformat am Telefon bleibt der Aufruf zum Spielen im ersten Bildschirm.
  h1.fitOpts = { max: () => Math.max(64, Math.min(420, window.innerHeight * (window.innerWidth > window.innerHeight * 1.6 ? 0.34 : 0.5))) };
  const kin = new Kinetic(h1, { conserve: true });
  let shots = [];
  let done = false;
  let glide = { x: 0, y: 0 };
  let down = null;
  let base = { x: 0, y: 0, fs: 100 };

  // Grundlinien-Marke hinter dem Punkt, damit die Lage des Punkts exakt bestimmbar ist
  const bullG = h1.querySelector('.g.bull-g');
  const bl = document.createElement('span');
  bl.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  bl.setAttribute('aria-hidden', 'true');
  bullG?.after(bl);

  function showBest() {
    const b = site.get('bestGroupMm');
    if (b) { bestEl.hidden = false; bestEl.textContent = `Bestwert: Ø${NNBSP}${num(b, 1, 1)}${NNBSP}mm`; } else bestEl.hidden = true;
  }
  showBest();
  site.onChange((k) => { if (k === 'bestGroupMm') showBest(); });

  /** Mittelpunkt des orangefarbenen Punkts relativ zum Zielfeld (ohne Gleitversatz). */
  function bullCenter() {
    if (!bullG) return { x: 0, y: 0 };
    const t = target.getBoundingClientRect();
    const g = bullG.getBoundingClientRect();
    const b = bl.getBoundingClientRect();
    const fs = parseFloat(getComputedStyle(bullG).fontSize) || 100;
    base.fs = fs;
    return { x: g.left + g.width / 2 - t.left - glide.x, y: b.top - (dotRatio * fs) / 2 - t.top - glide.y };
  }

  function placeBull() {
    const c = bullCenter();
    base.x = c.x;
    base.y = c.y;
    bull.style.setProperty('--bx', `${(c.x + glide.x).toFixed(1)}px`);
    bull.style.setProperty('--by', `${(c.y + glide.y).toFixed(1)}px`);
    const hd = Math.max(5, Math.min(10, 0.035 * base.fs));
    holesEl.style.setProperty('--hd', `${hd.toFixed(1)}px`);
  }
  h1.addEventListener('fitted', () => requestAnimationFrame(placeBull));
  window.addEventListener('resize', () => requestAnimationFrame(placeBull));

  function setMsg(l1, l2 = '') {
    msg.innerHTML = '';
    const a = document.createElement('span');
    a.className = 'l1';
    a.textContent = l1;
    msg.appendChild(a);
    if (l2) msg.appendChild(document.createTextNode(l2));
  }

  function kick(ix, iy) {
    if (reduced()) return;
    const t = target.getBoundingClientRect();
    const px = ix + t.left;
    const py = iy + t.top;
    const fs = base.fs;
    let best = -1;
    let bestD = Infinity;
    const rects = kin.glyphs.map((g) => g.getBoundingClientRect());
    rects.forEach((r, i) => {
      const dx = Math.max(r.left - px, 0, px - r.right);
      const dy = Math.max(r.top - py, 0, py - r.bottom);
      const d = Math.hypot(dx, dy);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best < 0 || bestD > 0.6 * fs) return;
    const m = glyphModel(kin.lines[kin.lineOf[best]]) || glyphModel(h1);
    const wd = m?.wdth ?? 100;
    const dw = Math.max(0, 125 - wd);
    const dg = 100;
    kin.budget(5);
    kin.impulse(best, dw, dg, SPRINGS.einschuss);
    for (const [o, f] of [[-1, 0.4], [1, 0.4], [-2, 0.15], [2, 0.15]]) {
      const j = best + o;
      if (j >= 0 && j < kin.n && kin.lineOf[j] === kin.lineOf[best]) kin.impulse(j, dw * f, dg * f, SPRINGS.einschuss);
    }
  }

  function clear(animated = true) {
    const old = [...holesEl.children];
    if (animated && !reduced() && old.length) {
      holesEl.classList.add('clearing');
      setTimeout(() => { for (const n of old) n.remove(); holesEl.classList.remove('clearing'); }, 240);
    } else for (const n of old) n.remove();
    shots = [];
    done = false;
    glide = { x: 0, y: 0 };
    h1.classList.remove('glide');
    h1.style.transform = '';
    placeBull();
    resetBtn.hidden = true;
  }

  function fire(ax, ay, baseR) {
    if (done) clear(false);
    const r = baseR + spread();
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * r;
    const ix = ax + Math.cos(a) * d;
    const iy = ay + Math.sin(a) * d;
    shots.push({ x: ix, y: iy });
    const hole = document.createElement('i');
    hole.className = 'hole';
    hole.style.left = `${ix.toFixed(1)}px`;
    hole.style.top = `${iy.toFixed(1)}px`;
    holesEl.appendChild(hole);
    kick(ix, iy);
    sound?.shot?.('pistol');
    if (shots.length < MAX_SHOTS) {
      setMsg(`Schuss ${shots.length} von ${MAX_SHOTS}.`);
      return;
    }
    result();
  }

  function result() {
    done = true;
    const c = { x: base.x, y: base.y };
    const mx = shots.reduce((s, p) => s + p.x, 0) / shots.length;
    const my = shots.reduce((s, p) => s + p.y, 0) / shots.length;
    let maxD = 0;
    for (let i = 0; i < shots.length; i++) for (let j = i + 1; j < shots.length; j++) maxD = Math.max(maxD, Math.hypot(shots[i].x - shots[j].x, shots[i].y - shots[j].y));
    const mm = Math.round(maxD * 25.4 / 96 * 10) / 10;
    const dx = mx - c.x;
    const dy = my - c.y;
    const off = Math.hypot(dx, dy);
    const ch = Math.round(Math.abs(dx) / CLICK_PX);
    const cv = Math.round(Math.abs(dy) / CLICK_PX);
    const group = `Streukreis Ø${NNBSP}${num(mm, 1, 1)}${NNBSP}mm.`;
    let line1;
    let line2;
    if (mm > 40 || off > 48) {
      line1 = `${group} Ruhig atmen, neu einschießen.`;
      line2 = '';
    } else {
      const parts = [];
      if (ch) parts.push(`${ch} Klick ${dx > 0 ? 'rechts' : 'links'}`);
      if (cv) parts.push(`${cv}${ch ? '' : ' Klick'} ${dy > 0 ? 'tief' : 'hoch'}`);
      const where = parts.length ? `Treffpunkt ${parts.join(', ')}.` : 'Treffpunkt im Zentrum.';
      line1 = `${group} ${where}`;
      line2 = 'Korrigiert. Nullpunkt gesetzt.';
      const prev = site.get('bestGroupMm');
      if (!prev || mm < prev) {
        site.set('bestGroupMm', mm);
        if (prev) line2 += ' Bester Streukreis bisher.';
      }
      if (!reduced()) {
        glide = { x: dx, y: dy };
        h1.classList.add('glide');
        h1.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
        bull.style.setProperty('--bx', `${(c.x + dx).toFixed(1)}px`);
        bull.style.setProperty('--by', `${(c.y + dy).toFixed(1)}px`);
      }
    }
    setMsg(line1, line2 ? ` ${line2}` : '');
    resetBtn.hidden = false;
    announce(`${line1} ${line2}`.trim(), { now: true });
  }

  target.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, type: e.pointerType || 'mouse' };
  });
  target.addEventListener('click', (e) => {
    if (e.button !== 0) return;
    if (e.detail === 0 || !down) {
      if (e.target === bull) { placeBull(); fire(base.x, base.y, 4); }
      return;
    }
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const type = down.type;
    down = null;
    if (moved > 6) return;
    const t = target.getBoundingClientRect();
    hit('hit', e.clientX, e.clientY);
    fire(e.clientX - t.left, e.clientY - t.top, type === 'touch' ? 6 : 2);
  });
  resetBtn.addEventListener('click', () => {
    clear(true);
    setMsg('Fünf Schuss auf den Punkt.');
    sound?.ui('back');
    bull.focus({ preventScroll: true });
  });

  measureDot();
  placeBull();
  return { kin, place: placeBull };
}
