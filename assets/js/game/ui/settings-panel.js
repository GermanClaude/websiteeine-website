// NULLPUNKT — Einstellungen (alle Schlüssel aus SETTINGS_SCHEMA außer 'intern'), gruppiert in Reitern,
// sofort wirksam (settings.set bei jeder Eingabe), synchron mit Änderungen aus anderen Tabs/der Website.

import { esc, num } from './dom.js';
import { ICON } from './icons.js';

const GROUPS = [
  ['steuerung', 'Steuerung', ICON.sliders],
  ['grafik', 'Grafik', ICON.eye],
  ['audio', 'Audio', ICON.sound],
  ['hud', 'HUD', ICON.crosshair],
  ['profil', 'Profil', ICON.user],
  ['spiel', 'Spiel', ICON.bot],
];
// Reihenfolge im Reiter „Steuerung“ nach Eingabeart; '|…' = Zwischenüberschrift für die Geräte, die gerade nicht benutzt werden
const CONTROL_ORDER = {
  touch: ['touchSensitivity', 'aimAssist', 'autoFire', 'invertY', '|Maus', 'sensitivity', 'adsSensitivity'],
  desktop: ['sensitivity', 'adsSensitivity', 'invertY', 'aimAssist', '|Touch', 'touchSensitivity', 'autoFire'],
};
const COLORS = ['#ffffff', '#ff5b1f', '#5fe08a', '#38b6ff', '#ffc23d', '#ff4fd8'];
const HINTS = {
  touchSensitivity: 'Nur auf Touchgeräten.',
  aimAssist: 'Verlangsamung und leichter Zug zum Ziel – Touch und Controller.',
  autoFire: 'Feuert automatisch, sobald ein Gegner im Fadenkreuz ist („einfacher Modus“).',
  quality: 'Automatisch passt sich dem Gerät an und regelt bei Ruckeln nach.',
  fov: 'Horizontales Sichtfeld (4:3).',
  reducedMotion: 'Weniger Kamerawackeln und Animationen.',
  difficulty: 'Vorgabe für die Lobby.',
  playerName: 'Erscheint in Tabelle und Abschussmeldungen.',
};

function fmt(key, v, s) {
  if (s.type !== 'number') return String(v);
  if (key.endsWith('Volume')) return `${Math.round(v * 100)} %`;
  if (key === 'fov') return `${Math.round(v)}°`;
  return num(v, 2);
}

export class SettingsPanel {
  constructor(G) {
    this.G = G;
    this.root = null;
    this.group = 'steuerung';
    this._off = null;
  }

  /** Baut das Panel in `host`. */
  mount(host) {
    const S = this.G.settings;
    const schema = S.schema || {};
    const groups = GROUPS.filter(([g]) => Object.values(schema).some((d) => d.group === g));
    if (!groups.find(([g]) => g === this.group)) this.group = groups[0] ? groups[0][0] : 'steuerung';
    const root = document.createElement('div');
    root.className = 'sp';
    root.innerHTML = `
      <div class="m-tabs sp-tabs" role="tablist">${groups.map(([g, label, icon]) => `<button type="button" class="m-tab" role="tab" data-g="${g}" aria-selected="${g === this.group}">${icon}<span>${label}</span></button>`).join('')}</div>
      <div class="sp-body m-scroll" data-scrollable></div>
      <div class="sp-foot"><button type="button" class="m-btn m-ghost sp-reset">${ICON.restart}<span>Standard für „<b></b>“</span></button><span class="sp-note">${S.persistent ? 'Wird auf diesem Gerät gespeichert.' : 'Speicher gesperrt: gilt nur bis zum Neuladen.'}</span></div>`;
    host.appendChild(root);
    this.root = root;
    this.body = root.querySelector('.sp-body');
    root.querySelector('.sp-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-g]');
      if (!b) return;
      this.group = b.dataset.g;
      root.querySelectorAll('[data-g]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      this._render();
    });
    root.querySelector('.sp-reset').addEventListener('click', () => {
      const patch = {};
      for (const [k, d] of Object.entries(schema)) if (d.group === this.group) patch[k] = S.defaults[k];
      S.patch(patch);
      this._render();
      this.G.events.emit('ui:sound', { name: 'back' });
    });
    this._render();
    this._off = S.onChange((key) => this._sync(key));
    return root;
  }

  unmount() {
    if (this._off) this._off();
    this._off = null;
    if (this.root) this.root.remove();
    this.root = null;
  }

  _render() {
    const S = this.G.settings;
    const schema = S.schema || {};
    const label = (GROUPS.find(([g]) => g === this.group) || [])[1] || '';
    this.root.querySelector('.sp-reset b').textContent = label;
    const rows = Object.entries(schema).filter(([, d]) => d.group === this.group);
    let items = rows.map(([k]) => k);
    if (this.group === 'steuerung') {
      const order = CONTROL_ORDER[this.G.input && this.G.input.mode === 'touch' ? 'touch' : 'desktop'];
      const rest = items.filter((k) => !order.includes(k));
      items = order.filter((k) => k[0] === '|' || items.includes(k)).flatMap((k) => (k[0] === '|' ? [...rest.splice(0), k] : [k]));
      items.push(...rest);
    }
    const html = items.map((k) => (k[0] === '|' ? `<h3 class="m-h2 sp-sub">${esc(k.slice(1))}</h3>` : this._row(k, schema[k], S.get(k)))).join('');
    this.body.innerHTML = html + (this.group === 'hud' ? '<div class="sp-xpreview" aria-hidden="true"><div class="sp-xh"><i class="l"></i><i class="r"></i><i class="t"></i><i class="b"></i><i class="c"></i><i class="o"></i></div><span>Vorschau</span></div>' : '');
    this._bind();
    this._preview();
  }

  _row(k, d, v) {
    const hint = HINTS[k] ? `<small>${esc(HINTS[k])}</small>` : '';
    const lab = `<div class="sp-lab"><span>${esc(d.label)}</span>${hint}</div>`;
    switch (d.type) {
      case 'number':
        return `<div class="sp-row" data-k="${k}">${lab}<div class="sp-ctl sp-range"><input type="range" min="${d.min}" max="${d.max}" step="${d.step || 0.01}" value="${v}" aria-label="${esc(d.label)}"><output>${fmt(k, v, d)}</output></div></div>`;
      case 'boolean':
        return `<div class="sp-row" data-k="${k}">${lab}<div class="sp-ctl"><button type="button" class="m-switch" role="switch" aria-checked="${!!v}" aria-label="${esc(d.label)}"><i></i></button></div></div>`;
      case 'enum':
        return `<div class="sp-row" data-k="${k}">${lab}<div class="sp-ctl m-seg" role="radiogroup">${d.options.map((o) => `<button type="button" role="radio" data-v="${esc(o)}" aria-checked="${o === v}">${esc((d.labels && d.labels[o]) || o)}</button>`).join('')}</div></div>`;
      case 'color':
        return `<div class="sp-row" data-k="${k}">${lab}<div class="sp-ctl sp-colors">${COLORS.map((c) => `<button type="button" class="sp-sw" data-v="${c}" style="--c:${c}" aria-label="Farbe ${c}" aria-pressed="${c === String(v).toLowerCase()}"></button>`).join('')}<label class="sp-sw sp-custom" aria-label="Eigene Farbe"><input type="color" value="${esc(v)}"></label></div></div>`;
      case 'string':
        return `<div class="sp-row" data-k="${k}">${lab}<div class="sp-ctl"><input class="m-input" type="text" maxlength="${d.maxLength || 32}" value="${esc(v)}" autocomplete="off" spellcheck="false" enterkeyhint="done" aria-label="${esc(d.label)}"></div></div>`;
      default:
        return '';
    }
  }

  _bind() {
    const S = this.G.settings;
    const schema = S.schema || {};
    this.body.querySelectorAll('.sp-row').forEach((row) => {
      const k = row.dataset.k;
      const d = schema[k];
      if (d.type === 'number') {
        const inp = row.querySelector('input');
        const out = row.querySelector('output');
        inp.addEventListener('input', () => { const v = S.set(k, inp.value); out.textContent = fmt(k, v, d); this._fill(inp); });
        this._fill(inp);
      } else if (d.type === 'boolean') {
        const b = row.querySelector('button');
        b.addEventListener('click', () => { const v = S.set(k, !S.get(k)); b.setAttribute('aria-checked', String(!!v)); this.G.events.emit('ui:sound', { name: 'toggle' }); });
      } else if (d.type === 'enum') {
        row.addEventListener('click', (e) => {
          const b = e.target.closest('[data-v]');
          if (!b) return;
          const v = S.set(k, b.dataset.v);
          row.querySelectorAll('[data-v]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.v === v)));
          this.G.events.emit('ui:sound', { name: 'click' });
          this._preview();
        });
      } else if (d.type === 'color') {
        row.addEventListener('click', (e) => {
          const b = e.target.closest('button[data-v]');
          if (!b) return;
          S.set(k, b.dataset.v);
          this._syncColor(row, S.get(k));
          this._preview();
        });
        const ci = row.querySelector('input[type=color]');
        ci.addEventListener('input', () => { S.set(k, ci.value); this._syncColor(row, S.get(k)); this._preview(); });
      } else if (d.type === 'string') {
        const inp = row.querySelector('input');
        const commit = () => { const v = S.set(k, inp.value); if (inp.value !== v) inp.value = v; };
        inp.addEventListener('change', commit);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); inp.blur(); } e.stopPropagation(); });
      }
    });
  }

  _fill(inp) {
    const min = Number(inp.min);
    const max = Number(inp.max);
    const p = ((Number(inp.value) - min) / (max - min || 1)) * 100;
    inp.style.setProperty('--p', `${p}%`);
  }

  _syncColor(row, v) {
    row.querySelectorAll('button[data-v]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === String(v).toLowerCase())));
    const ci = row.querySelector('input[type=color]');
    if (ci && ci.value.toLowerCase() !== String(v).toLowerCase()) ci.value = v;
  }

  /** Externe Änderung (anderer Tab, Website) → Steuerelement nachziehen. */
  _sync(key) {
    if (!this.root) return;
    const row = this.body.querySelector(`.sp-row[data-k="${key}"]`);
    if (!row) return;
    const S = this.G.settings;
    const d = S.schema[key];
    const v = S.get(key);
    if (d.type === 'number') {
      const inp = row.querySelector('input');
      if (document.activeElement !== inp) { inp.value = v; this._fill(inp); }
      row.querySelector('output').textContent = fmt(key, v, d);
    } else if (d.type === 'boolean') row.querySelector('button').setAttribute('aria-checked', String(!!v));
    else if (d.type === 'enum') row.querySelectorAll('[data-v]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.v === v)));
    else if (d.type === 'color') this._syncColor(row, v);
    else if (d.type === 'string') { const inp = row.querySelector('input'); if (document.activeElement !== inp) inp.value = v; }
    this._preview();
  }

  _preview() {
    const x = this.body && this.body.querySelector('.sp-xh');
    if (!x) return;
    const S = this.G.settings;
    x.dataset.style = S.get('crosshairStyle');
    x.style.setProperty('--cc', S.get('crosshairColor'));
  }
}
