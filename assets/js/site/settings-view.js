// §06 Einstellungen: Setzkasten. Formular aus SETTINGS_SCHEMA (ohne 'intern'), ein <fieldset> pro Gruppe.
// Jede Änderung gilt sofort für Website und Spiel; Änderungen aus anderen Tabs/dem Spiel kommen zurück.
import { h, $, signalLost } from './dom.js';
import { crosshairSvg } from './cursor.js';
import { announce } from './live.js';
import { num, NNBSP, clamp01 } from './fmt.js';

const GROUPS = [['profil', 'Profil'], ['steuerung', 'Steuerung'], ['hud', 'Fadenkreuz & HUD'], ['grafik', 'Grafik'], ['audio', 'Audio'], ['spiel', 'Spiel']];
const SWATCHES = [['#ffffff', 'Weiß'], ['#ff5b1f', 'Signalorange'], ['#38b6ff', 'Blau'], ['#5fe08a', 'Grün'], ['#ffc23d', 'Gelb']];
const QUALITY_HELP = {
  auto: 'Automatisch: Telefon niedrig, Rechner hoch.',
  low: 'Niedrig: keine Schatten, volle Bildrate.',
  medium: 'Mittel: Schatten und Glanz.',
  high: 'Hoch: weiche Schatten, Kantenglättung.',
  ultra: 'Ultra: Umgebungsverdeckung, 4K-Schatten.',
};
const HELP = {
  fov: 'Waagerecht gemessen, bezogen auf ein 4:3-Bild. Breitere Bildschirme sehen seitlich mehr.',
  aimAssist: 'Zieht das Fadenkreuz leicht zu nahen Gegnern. Nur Touch und Controller.',
  autoFire: 'Feuert von selbst, sobald das Fadenkreuz auf einem Gegner liegt. Nur Touch.',
  reducedMotion: 'Stoppt Federn, Wellen und Übergänge auf der Website, im Spiel Kamerawackeln.',
};

/** Website-eigene Beschriftungen, wo das Schema englischen Fachjargon nutzt. */
const LABELS = { showFps: 'Bildrate anzeigen' };
const DEG = 180 / Math.PI;
/**
 * settings.fov ist wie bei COD das horizontale Sichtfeld eines 4:3-Bilds (game/player.js hfovToVfov):
 * Die Kamera nutzt das vertikale Äquivalent, breitere Bildschirme sehen seitlich mehr (Hor+).
 * @returns {{ v: number, h169: number }} vertikal und horizontal bei 16:9, in Radiant
 */
function fovAngles(h43) {
  const v = 2 * Math.atan(Math.tan((h43 / DEG) / 2) * 0.75);
  return { v, h169: 2 * Math.atan(Math.tan(v / 2) * (16 / 9)) };
}
const isVolume = (k) => /Volume$/.test(k);
function fmtValue(k, s, v) {
  if (isVolume(k)) return `${num(v * 100)}${NNBSP}%`;
  if (s.unit === '°') return `${num(v)}°`;
  if (s.integer) return `${num(v)}${s.unit ? NNBSP + s.unit : ''}`;
  const digits = (String(s.step ?? 0.01).split('.')[1] || '').length || 2;
  return num(v, digits, digits);
}
function speakValue(k, s, v) {
  if (isVolume(k)) return `${Math.round(v * 100)} Prozent`;
  if (k === 'fov') return `${Math.round(v)} Grad horizontal bei 4:3, ${Math.round(fovAngles(v).h169 * DEG)} Grad bei 16:9`;
  if (s.unit === '°') return `${Math.round(v)} Grad`;
  return String(Math.round(v * 100) / 100).replace('.', ',');
}
const throttle = (ms, fn) => {
  let last = 0;
  let t = 0;
  let args = null;
  return (...a) => {
    args = a;
    const now = performance.now();
    if (now - last >= ms) { last = now; fn(...args); }
    else { clearTimeout(t); t = setTimeout(() => { last = performance.now(); fn(...args); }, ms - (now - last)); }
  };
};

export async function init(sec, D, ctx = {}) {
  const root = $('#settings-root', sec);
  if (!root) return;
  const S = D.settings;
  const schema = D.schema;
  const snd = ctx.sound;
  if (!schema || !D.ok.settings) { signalLost(root, 'Die Einstellungen sind gerade nicht erreichbar. Es gelten die Standardwerte.'); return; }

  const form = h('form.set-form', { novalidate: '' });
  form.addEventListener('submit', (e) => e.preventDefault());
  const updaters = {};
  const clickT = throttle(120, () => snd?.ui('click'));

  for (const [gid, legend] of GROUPS) {
    const keys = Object.keys(schema).filter((k) => schema[k].group === gid);
    if (!keys.length) continue;
    const fs = h('fieldset.set-grp');
    fs.append(h('legend.set-legend', {}, legend));
    for (const k of keys) {
      const row = buildRow(k, { ...schema[k], label: LABELS[k] || schema[k].label });
      if (row) fs.append(row);
    }
    form.append(fs);
  }

  function buildRow(k, s) {
    const id = `set-${k}`;
    const lab = h('div.r');
    const ctl = h('div.m.set-ctl');
    const row = h('div.set-row', { 'data-key': k }, lab, ctl);
    const help = HELP[k] ? h('p.set-help', { id: `${id}-help` }, HELP[k]) : null;

    if (s.type === 'number') {
      lab.append(h('label', { for: id }, s.label));
      const input = h('input', { type: 'range', id, min: s.min, max: s.max, step: s.step ?? 'any', 'aria-describedby': help ? help.id : null });
      const thumb = h('span.thumb');
      const box = h('div.range.small', {}, h('span.track'), thumb, input);
      const val = h('span.set-val', { 'aria-hidden': 'true' });
      ctl.append(h('div.set-num', {}, box, val));
      const set = throttle(50, (v) => S.set(k, v));
      input.addEventListener('input', () => {
        const v = Number(input.value);
        paint(v);
        set(v);
        if (isVolume(k)) clickT();
      });
      const paint = (v) => {
        const f = clamp01((v - s.min) / (s.max - s.min));
        thumb.style.setProperty('--v', (f * 100).toFixed(2));
        val.textContent = fmtValue(k, s, v);
        val.style.setProperty('--sw', (62 + 63 * f).toFixed(1));
        input.setAttribute('aria-valuetext', speakValue(k, s, v));
        if (k === 'fov') fov(v);
      };
      let fov = () => {};
      if (k === 'fov') {
        const svgEl = h('span.fov-svg', { 'aria-hidden': 'true' });
        const txt = h('span.mono-s');
        ctl.append(h('div.fov-prev', {}, svgEl, txt));
        // Keil mit Spitze unten (das Auge), Schenkel im echten Winkel, den ein 16:9-Bildschirm im Spiel zeigt;
        // SICHTFELD steht zwischen den Schenkeln und füllt deren Abstand auf seiner Höhe – breiter Winkel, breiter Schnitt.
        const W = 2 * Math.sin(fovAngles(s.max).h169 / 2) * 100; // Rahmen für den größten Winkel
        fov = (v) => {
          const a = fovAngles(v);
          const half = a.h169 / 2;
          const L = 100;
          const x = Math.sin(half) * L;
          const y = Math.cos(half) * L;
          const f = clamp01((v - s.min) / (s.max - s.min));
          const wd = (62 + 63 * f).toFixed(1);
          const ty = y * 0.62; // Höhe der Schrift über der Spitze
          // Schriftgröße so, dass das Wort auch an seiner Unterkante zwischen die Schenkel passt
          const per = 9 * (0.45 + 0.35 * f);
          let fsz = ty * 0.4;
          for (let it = 0; it < 3; it++) fsz = Math.min(ty * 0.4, (2 * Math.tan(half) * (ty - 0.38 * fsz) * 0.84) / per);
          svgEl.innerHTML = `<svg viewBox="${(-W / 2).toFixed(1)} ${(-L - 2).toFixed(1)} ${W.toFixed(1)} ${(L + 6).toFixed(1)}"><line x1="0" y1="0" x2="${(-x).toFixed(1)}" y2="${(-y).toFixed(1)}"/><line x1="0" y1="0" x2="${x.toFixed(1)}" y2="${(-y).toFixed(1)}"/><circle cx="0" cy="0" r="2"/><text x="0" y="${(-ty).toFixed(1)}" font-size="${fsz.toFixed(2)}" dominant-baseline="central" text-anchor="middle" style="font-stretch:${wd}%">SICHTFELD</text></svg>`;
          txt.textContent = `${num(v)}° horizontal (4:3) · ${num(Math.round(a.h169 * DEG))}° bei 16:9 · ${num(Math.round(a.v * DEG))}° vertikal`;
        };
      }
      updaters[k] = (v) => { input.value = String(v); paint(Number(v)); };
    } else if (s.type === 'boolean') {
      lab.append(h('span', { id: `${id}-l` }, s.label));
      const input = h('input', { type: 'checkbox', role: 'switch', id, 'aria-labelledby': `${id}-l`, 'aria-describedby': help ? help.id : null });
      const on = h('span', { 'aria-hidden': 'true' }, 'AN');
      const off = h('span', { 'aria-hidden': 'true' }, 'AUS');
      ctl.append(h('label.sw', { for: id }, input, on, h('span.sl', { 'aria-hidden': 'true' }, '/'), off));
      input.addEventListener('change', () => { S.set(k, input.checked); snd?.ui('click'); });
      updaters[k] = (v) => { input.checked = !!v; on.classList.toggle('on', !!v); off.classList.toggle('on', !v); };
    } else if (s.type === 'enum') {
      const legendId = `${id}-l`;
      lab.append(h('span', { id: legendId }, s.label));
      const group = h('div.enum', { role: 'radiogroup', 'aria-labelledby': legendId });
      const radios = [];
      for (const opt of s.options) {
        const r = h('input', { type: 'radio', name: id, value: opt, id: `${id}-${opt}` });
        r.addEventListener('change', () => { if (r.checked) { S.set(k, opt); snd?.ui('click'); } });
        radios.push(r);
        group.append(h('label', { for: r.id }, r, h('span', {}, s.labels?.[opt] || opt)));
      }
      ctl.append(group);
      let qhelp = null;
      if (k === 'quality') { qhelp = h('p.q-help', { 'aria-live': 'polite' }); ctl.append(qhelp); }
      if (k === 'crosshairStyle') ctl.append(h('span.xh-prev', { 'aria-hidden': 'true', id: 'xh-prev' }));
      updaters[k] = (v) => {
        for (const r of radios) r.checked = r.value === v;
        if (qhelp) qhelp.textContent = QUALITY_HELP[v] || '';
        if (k === 'crosshairStyle') paintXh();
      };
    } else if (s.type === 'color') {
      lab.append(h('label', { for: id }, s.label));
      const input = h('input', { type: 'color', id });
      const hex = h('span.hex', { 'aria-hidden': 'true' });
      const sw = SWATCHES.map(([c, n]) => {
        const b = h('button.swatch', { type: 'button', 'aria-label': n, 'aria-pressed': 'false', style: { '--c': c } }, h('i'));
        b.addEventListener('click', () => { S.set(k, c); snd?.ui('click'); });
        return b;
      });
      ctl.append(h('div.colors', {}, input, hex, ...sw));
      if (k === 'crosshairColor' && !schema.crosshairStyle) ctl.append(h('span.xh-prev', { 'aria-hidden': 'true', id: 'xh-prev' }));
      input.addEventListener('input', () => S.set(k, input.value));
      updaters[k] = (v) => {
        input.value = v;
        hex.textContent = String(v).toUpperCase();
        for (const [i, b] of sw.entries()) b.setAttribute('aria-pressed', String(SWATCHES[i][0] === String(v).toLowerCase()));
        paintXh();
      };
    } else if (s.type === 'string') {
      lab.append(h('label', { for: id }, s.label));
      const input = h('input.name-in', { type: 'text', id, maxlength: String(s.maxLength || 16), autocomplete: 'nickname', spellcheck: 'false', enterkeyhint: 'done' });
      ctl.append(input);
      const commit = () => {
        const v = input.value;
        if (k === 'playerName' && typeof D.profile?.setName === 'function') D.profile.setName(v); else S.set(k, v);
        input.value = S.get(k);
      };
      input.addEventListener('change', commit);
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); input.blur(); } });
      updaters[k] = (v) => { if (document.activeElement !== input) input.value = v ?? ''; };
    } else {
      return null;
    }
    if (help) ctl.append(help);
    return row;
  }

  function paintXh() {
    const el = form.querySelector('#xh-prev');
    if (!el) return;
    el.innerHTML = crosshairSvg(S.get('crosshairStyle') || 'cross', S.get('crosshairColor') || '#ffffff', 64);
  }

  /* ------------------------------------------------------------ Werkzeuge */
  const reset = h('button.txt-btn', { type: 'button' }, 'Auf Standard setzen');
  const tools = h('div.span.set-tools-row', {}, h('div.r'), h('div.m.set-tools', {}, reset));
  let armT = 0;
  reset.addEventListener('click', () => {
    if (!reset.classList.contains('armed')) {
      reset.classList.add('armed');
      reset.textContent = 'Wirklich zurücksetzen?';
      clearTimeout(armT);
      armT = setTimeout(() => { reset.classList.remove('armed'); reset.textContent = 'Auf Standard setzen'; }, 4000);
      return;
    }
    clearTimeout(armT);
    reset.classList.remove('armed');
    reset.textContent = 'Auf Standard setzen';
    S.reset();
    announce('Einstellungen zurückgesetzt.', { now: true });
    snd?.ui('back');
  });
  if (S.persistent === false) tools.querySelector('.set-tools').prepend(h('p.note', {}, 'Speichern nicht möglich (privates Fenster?). Änderungen gelten bis zum Schließen.'));

  root.replaceChildren();
  root.hidden = true;
  sec.append(form, tools);

  const all = S.all();
  for (const [k, fn] of Object.entries(updaters)) fn(all[k]);
  S.onChange((k, v) => updaters[k]?.(v));
}
