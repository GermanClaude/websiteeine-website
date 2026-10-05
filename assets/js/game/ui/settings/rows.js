// NULLPUNKT — Einstellungszeilen aus SETTINGS_SCHEMA (Schieberegler, Schalter, Segmentleiste, Wähler ‹ Wert ›,
// Farbfelder, Text). Ereignisse per Delegation am Seitencontainer (bindRows), Nachziehen bei Änderungen von außen
// (syncRows). Bedienbar per Touch, Maus, Tastatur (Pfeile links/rechts am Wähler) und Gamepad (menus.js schickt
// links/rechts als „np-step“ an fokussierte Wähler und Schieberegler).

import { esc, num } from '../dom.js';

export const COLORS = ['#ffffff', '#ff5b1f', '#5fe08a', '#38b6ff', '#ffc23d', '#ff4fd8'];

/** Regler 0–1 bzw. Faktoren, die als Prozent lesbarer sind. */
const PCT = new Set(['cameraMotion', 'weaponSway', 'lensStrength', 'grain', 'lensArtifacts', 'sharpness', 'touchOpacity',
  'touchButtonScale', 'aimAssistStrength', 'aimAssistLevel', 'autoFireLevel', 'padDeadzone', 'padOuterDeadzone', 'masterVolume', 'sfxVolume', 'musicVolume', 'uiVolume']);
/** Faktoren mit „ד. */
const MULT = new Set(['sensitivityY', 'adsSensitivity', 'adsSensitivityMid', 'adsSensitivityHigh', 'gyroSensitivityX', 'gyroSensitivityY',
  'padSensitivity', 'touchSensitivity']);

/** Anzeige eines Werts (deutsch). */
export function fmtValue(key, v, def) {
  if (!def) return String(v);
  if (def.type === 'number') {
    if (PCT.has(key)) return `${Math.round(v * 100)} %`;
    if (key === 'fov') return `${Math.round(v)}°`;
    if (MULT.has(key)) return `${num(v, 2)}×`;
    return num(v, 2);
  }
  if (def.type === 'enum') return (def.labels && def.labels[v]) || String(v);
  if (def.type === 'boolean') return v ? 'An' : 'Aus';
  return String(v ?? '');
}

/** Lange Wahllisten (viele Optionen oder lange Beschriftungen) bekommen einen Wähler ‹ Wert › statt einer Segmentleiste. */
function useStepper(def, opts) {
  if (opts.control === 'seg') return false;
  if (opts.control === 'step') return true;
  const labels = def.options.map((o) => (def.labels && def.labels[o]) || o);
  return def.options.length > 4 || labels.join('').length > 34;
}

/**
 * HTML einer Zeile. ctx = { settings, schema, labels(key) → {option: Beschriftung} (optional) }. opts = { label, hint, labels (Ersatzbeschriftungen je Option),
 * control: 'seg'|'step', disabled, note (Grund für disabled), cost (Text rechts in der Beschriftung), wide }.
 */
export function rowHtml(ctx, key, opts = {}) {
  const S = ctx.settings;
  const def = (ctx.schema || S.schema)[key];
  if (!def) return '';
  const v = S.get(key);
  const label = opts.label || def.label;
  const hint = opts.hint ? `<small>${esc(opts.hint)}</small>` : '';
  const note = opts.disabled && opts.note ? `<small class="sp-note-dis">${esc(opts.note)}</small>` : '';
  const cost = opts.cost ? `<em class="sp-cost">${esc(opts.cost)}</em>` : '';
  const lab = `<div class="sp-lab"><span>${esc(label)}${cost}</span>${hint}${note}</div>`;
  const dis = opts.disabled ? ' is-disabled' : '';
  const da = opts.disabled ? ' disabled' : '';
  const aria = esc(label);
  switch (def.type) {
    case 'number': {
      const p = ((Number(v) - def.min) / (def.max - def.min || 1)) * 100;
      return `<div class="sp-row${dis}" data-k="${key}">${lab}<div class="sp-ctl sp-range"><input type="range" min="${def.min}" max="${def.max}" step="${def.step || 0.01}" value="${v}" aria-label="${aria}" style="--p:${p.toFixed(1)}%"${da}><output>${esc(fmtValue(key, v, def))}</output></div></div>`;
    }
    case 'boolean':
      return `<div class="sp-row${dis}" data-k="${key}">${lab}<div class="sp-ctl"><button type="button" class="m-switch" role="switch" aria-checked="${!!v}" aria-label="${aria}"${da}><i></i></button></div></div>`;
    case 'enum': {
      const labels = { ...(def.labels || {}), ...((ctx.labels && ctx.labels(key)) || {}), ...(opts.labels || {}) };
      if (useStepper(def, opts)) {
        const i = Math.max(0, def.options.indexOf(v));
        const pips = def.options.map((o, j) => `<i${j === i ? ' class="is-on"' : ''}></i>`).join('');
        return `<div class="sp-row sp-row-step${dis}" data-k="${key}">${lab}<div class="sp-ctl"><div class="sp-step" role="slider" tabindex="${opts.disabled ? -1 : 0}" aria-label="${aria}" aria-valuemin="0" aria-valuemax="${def.options.length - 1}" aria-valuenow="${i}" aria-valuetext="${esc(labels[v] || v)}"${opts.disabled ? ' aria-disabled="true"' : ''}>
          <button type="button" class="sp-step-b" data-d="-1" tabindex="-1" aria-label="Vorherige Option"${da}>‹</button><output>${esc(labels[v] || v)}</output><button type="button" class="sp-step-b" data-d="1" tabindex="-1" aria-label="Nächste Option"${da}>›</button><span class="sp-pips" aria-hidden="true">${pips}</span></div></div></div>`;
      }
      const wide = opts.wide || def.options.length >= 5;
      return `<div class="sp-row${wide ? ' sp-row-wide' : ''}${dis}" data-k="${key}">${lab}<div class="sp-ctl m-seg" role="radiogroup" aria-label="${aria}">${def.options.map((o) => `<button type="button" role="radio" data-v="${esc(o)}" aria-checked="${o === v}"${da}>${esc(labels[o] || o)}</button>`).join('')}</div></div>`;
    }
    case 'color':
      return `<div class="sp-row${dis}" data-k="${key}">${lab}<div class="sp-ctl sp-colors">${COLORS.map((c) => `<button type="button" class="sp-sw" data-v="${c}" style="--c:${c}" aria-label="Farbe ${c}" aria-pressed="${c === String(v).toLowerCase()}"></button>`).join('')}<label class="sp-sw sp-custom" aria-label="Eigene Farbe"><input type="color" value="${esc(v)}"></label></div></div>`;
    case 'string':
      return `<div class="sp-row${dis}" data-k="${key}">${lab}<div class="sp-ctl"><input class="m-input" type="text" maxlength="${def.maxLength || 32}" value="${esc(v)}" autocomplete="off" spellcheck="false" enterkeyhint="done" aria-label="${aria}"></div></div>`;
    default:
      return '';
  }
}

/** Zwischenüberschrift (optional mit Anker-ID für Sprungmarken). */
export function headHtml(text, id = '') {
  return `<h3 class="m-h2 sp-sub"${id ? ` data-sec="${esc(id)}"` : ''}>${esc(text)}</h3>`;
}

function fillRange(inp) {
  const min = Number(inp.min);
  const max = Number(inp.max);
  inp.style.setProperty('--p', `${(((Number(inp.value) - min) / (max - min || 1)) * 100).toFixed(1)}%`);
}

/** Wähler um d Schritte weiterschalten (begrenzt, ohne Umlauf). */
function step(ctx, row, d) {
  const S = ctx.settings;
  const key = row.dataset.k;
  const def = S.schema[key];
  if (!def || row.classList.contains('is-disabled')) return;
  const i = def.options.indexOf(S.get(key));
  const j = Math.max(0, Math.min(def.options.length - 1, (i < 0 ? 0 : i) + d));
  if (j === i) { ctx.sound && ctx.sound('back'); return; }
  S.set(key, def.options[j]);
  ctx.sound && ctx.sound('click');
}

/**
 * Ereignisse aller Zeilen in `root` (Delegation, einmal je Container). ctx = { settings, sound(name), after(key) }.
 * Gibt eine Abmeldefunktion zurück.
 */
export function bindRows(root, ctx) {
  const S = ctx.settings;
  const rowOf = (t) => t && t.closest && t.closest('.sp-row');
  const after = (k) => { if (ctx.after) ctx.after(k); };
  const onInput = (e) => {
    const row = rowOf(e.target);
    if (!row) return;
    const k = row.dataset.k;
    const def = S.schema[k];
    if (!def) return;
    if (def.type === 'number' && e.target.type === 'range') {
      const v = S.set(k, e.target.value);
      const out = row.querySelector('output');
      if (out) out.textContent = fmtValue(k, v, def);
      fillRange(e.target);
      after(k);
    } else if (def.type === 'color' && e.target.type === 'color') {
      S.set(k, e.target.value);
      after(k);
    }
  };
  const onClick = (e) => {
    const row = rowOf(e.target);
    if (!row || row.classList.contains('is-disabled')) return;
    const k = row.dataset.k;
    const def = S.schema[k];
    if (!def) return;
    if (def.type === 'boolean') {
      if (!e.target.closest('.m-switch')) return;
      S.set(k, !S.get(k));
      ctx.sound && ctx.sound('toggle');
      after(k);
    } else if (def.type === 'enum') {
      const sb = e.target.closest('.sp-step-b');
      if (sb) { step(ctx, row, Number(sb.dataset.d)); after(k); return; }
      const st = e.target.closest('.sp-step');
      if (st) { step(ctx, row, 1); after(k); return; } // Antippen der Mitte = weiter
      const b = e.target.closest('[data-v]');
      if (!b) return;
      S.set(k, b.dataset.v);
      ctx.sound && ctx.sound('click');
      after(k);
    } else if (def.type === 'color') {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      S.set(k, b.dataset.v);
      after(k);
    }
  };
  const onKey = (e) => {
    const st = e.target.closest && e.target.closest('.sp-step');
    if (st && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      e.preventDefault();
      e.stopPropagation();
      const row = rowOf(st);
      step(ctx, row, e.code === 'ArrowLeft' ? -1 : 1);
      after(row.dataset.k);
      return;
    }
    const inp = e.target.closest && e.target.closest('input.m-input');
    if (inp) {
      e.stopPropagation(); // Tippen im Namensfeld löst keine Menüsteuerung aus
      if (e.key === 'Enter') { commit(inp); inp.blur(); }
    }
  };
  const commit = (inp) => {
    const row = rowOf(inp);
    if (!row) return;
    const v = S.set(row.dataset.k, inp.value);
    if (inp.value !== v) inp.value = v;
    after(row.dataset.k);
  };
  const onChange = (e) => { if (e.target.matches && e.target.matches('input.m-input')) commit(e.target); };
  // Gamepad (menus.js): links/rechts an fokussiertem Wähler
  const onStep = (e) => {
    const st = e.target.closest && e.target.closest('.sp-step');
    if (!st) return;
    const row = rowOf(st);
    step(ctx, row, e.detail && e.detail.d < 0 ? -1 : 1);
    after(row.dataset.k);
  };
  root.addEventListener('input', onInput);
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  root.addEventListener('change', onChange);
  root.addEventListener('np-step', onStep);
  return () => {
    root.removeEventListener('input', onInput);
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKey);
    root.removeEventListener('change', onChange);
    root.removeEventListener('np-step', onStep);
  };
}

/** Steuerelemente der Zeile(n) `key` an den gespeicherten Wert angleichen (Änderung von außen / Vorlage). */
export function syncRows(root, ctx, key) {
  const S = ctx.settings;
  const def = S.schema[key];
  if (!def || !root) return;
  const v = S.get(key);
  for (const row of root.querySelectorAll(`.sp-row[data-k="${key}"]`)) {
    if (def.type === 'number') {
      const inp = row.querySelector('input');
      if (inp && document.activeElement !== inp) { inp.value = v; fillRange(inp); }
      const out = row.querySelector('output');
      if (out) out.textContent = fmtValue(key, v, def);
    } else if (def.type === 'boolean') {
      const b = row.querySelector('.m-switch');
      if (b) b.setAttribute('aria-checked', String(!!v));
    } else if (def.type === 'enum') {
      const labels = { ...(def.labels || {}), ...((ctx.labels && ctx.labels(key)) || {}) };
      const st = row.querySelector('.sp-step');
      if (st) {
        const i = Math.max(0, def.options.indexOf(v));
        const out = st.querySelector('output');
        if (out) out.textContent = labels[v] || v;
        st.setAttribute('aria-valuenow', String(i));
        st.setAttribute('aria-valuetext', labels[v] || v);
        st.querySelectorAll('.sp-pips i').forEach((p, j) => p.classList.toggle('is-on', j === i));
      } else row.querySelectorAll('[data-v]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.v === v)));
    } else if (def.type === 'color') {
      row.querySelectorAll('button[data-v]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === String(v).toLowerCase())));
      const ci = row.querySelector('input[type=color]');
      if (ci && ci.value.toLowerCase() !== String(v).toLowerCase()) ci.value = v;
    } else if (def.type === 'string') {
      const inp = row.querySelector('input');
      if (inp && document.activeElement !== inp) inp.value = v;
    }
  }
}

/** Zeile(n) sperren/freigeben (z. B. Bloom ohne volle Nachbearbeitung), mit Begründung. */
export function setRowDisabled(root, key, disabled, note = '') {
  for (const row of root.querySelectorAll(`.sp-row[data-k="${key}"]`)) {
    row.classList.toggle('is-disabled', !!disabled);
    row.querySelectorAll('button, input').forEach((n) => { n.disabled = !!disabled; });
    const st = row.querySelector('.sp-step');
    if (st) { st.tabIndex = disabled ? -1 : 0; if (disabled) st.setAttribute('aria-disabled', 'true'); else st.removeAttribute('aria-disabled'); }
    let n = row.querySelector('.sp-note-dis');
    if (disabled && note) {
      if (!n) { n = document.createElement('small'); n.className = 'sp-note-dis'; row.querySelector('.sp-lab').appendChild(n); }
      n.textContent = note;
    } else if (n) n.remove();
  }
}

/** Kostenangabe in der Beschriftung setzen („≈ 32 MB“). */
export function setRowCost(root, key, text) {
  for (const row of root.querySelectorAll(`.sp-row[data-k="${key}"]`)) {
    const span = row.querySelector('.sp-lab > span');
    if (!span) continue;
    let c = span.querySelector('.sp-cost');
    if (!text) { if (c) c.remove(); continue; }
    if (!c) { c = document.createElement('em'); c.className = 'sp-cost'; span.appendChild(c); }
    if (c.textContent !== text) c.textContent = text;
  }
}

/** Beschriftung einer Option des Wählers/der Segmentleiste ersetzen (z. B. „Automatisch (Hoch)“). */
export function setOptionLabel(root, key, option, text) {
  for (const row of root.querySelectorAll(`.sp-row[data-k="${key}"]`)) {
    const b = row.querySelector(`[data-v="${CSS.escape(option)}"]`);
    if (b && b.textContent !== text) b.textContent = text;
  }
}
