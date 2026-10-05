// NULLPUNKT — Reiter „Belegung“ (Realismus-Plan S1/S3/S7): Tastatur & Maus und Controller frei belegen
// („Taste drücken …“ über input.capture), Konflikte markieren und beim Belegen tauschen (mit „Rückgängig“),
// Halten/Umschalten je Aktion, Standard je Aktion bzw. Gerät; Touch: Vorlagen, Stick, zusätzliche Knöpfe,
// Einstieg in den Layout-Editor.

import { esc } from '../dom.js';
import { ICON } from '../icons.js';
import {
  ACTION_DEFS, ACTION_GROUPS, DEFAULT_BINDINGS, MAX_SLOTS, TOUCH_PRESETS, TOUCH_BUTTONS,
  resolveBindings, setBinding, resetBindings, conflictsOf, codeWarning, resolveTouchLayout, sanitizeTouchLayout,
} from '../../../shared/bindings.data.js';
import { keyHtml, keyText, padStyle, touchAspect, editTouch, seedAspect } from './keys.js';
import { rowHtml, bindRows, syncRows } from './rows.js';

const DEVICES = [['kb', 'Tastatur & Maus', ICON.keyboard], ['pad', 'Controller', ICON.pad], ['touch', 'Touch', ICON.touch]];
const MODE_LABEL = { hold: 'Halten', toggle: 'Umschalten' };
// Zusätzliche Touch-Knöpfe: optional (aus) bzw. automatisch (sobald es die Funktion gibt)
const EXTRA = [
  { ids: ['adsfire'], label: 'Zielen + Feuern', hint: 'Halten legt an und feuert, Ziehen dreht die Sicht.' },
  { ids: ['leanL', 'leanR'], label: 'Lehnen links und rechts', hint: 'Antippen lehnt um die Ecke, nochmal tippen richtet auf.' },
  { ids: ['light'], label: 'Lampe', hint: 'Erscheint automatisch mit Taschenlampe oder Waffenlicht.', auto: true },
  { ids: ['tactical'], label: 'Taktische Granate', hint: 'Erscheint automatisch mit Blend- oder Rauchgranate.', auto: true },
];
// Mini-Schema je Vorlage (Mitte in %, r = Radius in %): Stick, Feuer, linker Feuerknopf, Springen, Ducken, Zielen
const PREVIEW = {
  standard: [['s', 18, 72, 11], ['f', 88, 62, 9], ['l', 9, 36, 6], ['b', 96, 40, 5], ['b', 96, 88, 5], ['b', 79, 58, 6]],
  klaue: [['s', 18, 72, 11], ['f', 88, 62, 9], ['l', 8, 24, 7], ['b', 81, 22, 5], ['b', 95, 52, 5], ['b', 91, 30, 6]],
  links: [['s', 82, 72, 11], ['f', 12, 62, 9], ['l', 91, 36, 6], ['b', 4, 40, 5], ['b', 4, 88, 5], ['b', 21, 58, 6]],
};

export function bindingsPage(P) {
  const G = P.G;
  const S = P.settings;
  let host = null;
  let offRows = null;
  let capturing = null; // { action, slot, btn }
  let toastT = 0;
  const state = P.state.belegung || (P.state.belegung = {
    device: G.input && G.input.mode === 'touch' ? 'touch' : G.input && G.input.lastDevice === 'gamepad' ? 'pad' : 'kb',
  });

  const resolved = () => resolveBindings(S.get('bindings'));
  const actionName = (id) => { const a = ACTION_DEFS.find((x) => x.id === id); return a ? a.short || a.label : id; };

  /* ---------------------------------------------------------- Tastatur / Controller */

  function rowHtmlFor(a, res, dev) {
    const list = res[dev][a.id] || [];
    const def = DEFAULT_BINDINGS[dev][a.id] || [];
    const changed = list.length !== def.length || list.some((c, i) => c !== def[i]);
    const conf = conflictsOf(res, dev, a.id);
    const slots = Math.min(MAX_SLOTS, Math.max(2, list.length));
    const warn = list.map(codeWarning).find(Boolean);
    let mode = '';
    if (a.modeKey) {
      const v = S.get(a.modeKey);
      mode = `<div class="bd-mode m-seg" role="radiogroup" aria-label="${esc(a.short || a.label)}: Halten oder Umschalten" data-mode="${a.modeKey}">${['hold', 'toggle'].map((o) => `<button type="button" role="radio" data-mv="${o}" aria-checked="${o === v}">${MODE_LABEL[o]}</button>`).join('')}</div>`;
    }
    const keys = [];
    for (let i = 0; i < slots; i++) {
      const c = list[i] || null;
      const isConf = c && conf.some((x) => x.code === c);
      keys.push(`<div class="bd-slot"><button type="button" class="bd-key${c ? '' : ' is-empty'}${isConf ? ' is-conflict' : ''}" data-slot="${i}" aria-label="${esc(a.label)}: Belegung ${i + 1}${c ? ` (${esc(keyText(G, c, { long: true }))})` : ' (leer)'} ändern">${c ? keyHtml(G, c) : '<span class="bd-none">+</span>'}</button>${c && !a.fixed ? `<button type="button" class="bd-clear" data-clear="${i}" aria-label="Belegung ${i + 1} entfernen">${ICON.close}</button>` : ''}</div>`);
    }
    const note = conf.length
      ? `<small class="bd-warn">${ICON.warn}Doppelt mit ${conf.map((c) => c.with.map((w) => `„${esc(actionName(w))}“`).join(', ')).join(', ')}</small>`
      : warn ? `<small class="bd-warn is-soft">${ICON.info}${esc(warn)}</small>` : '';
    return `<div class="bd-row${conf.length ? ' is-conflict' : ''}${a.fixed ? ' is-fixed' : ''}" data-a="${a.id}">
      <div class="bd-lab"><span>${esc(a.label)}</span>${note}${mode}</div>
      <div class="bd-keys">${a.fixed ? `<div class="bd-slot"><span class="bd-key is-fixed">${keyHtml(G, list[0])}</span></div><small class="bd-fix">fest</small>` : keys.join('')}</div>
      <button type="button" class="m-icon bd-reset" data-reset aria-label="${esc(a.short || a.label)}: Standard"${changed && !a.fixed ? '' : ' hidden'}>${ICON.undo}</button>
    </div>`;
  }

  function listHtml(dev) {
    const res = resolved();
    let html = '';
    for (const [g, label] of Object.entries(ACTION_GROUPS)) {
      let acts = ACTION_DEFS.filter((a) => a.group === g);
      if (dev === 'pad') acts = acts.filter((a) => !a.id.startsWith('move_'));
      if (!acts.length) continue;
      html += `<h3 class="m-h2 sp-sub">${esc(label)}</h3>`;
      if (dev === 'pad' && g === 'bewegung') html += '<p class="sp-tip">Bewegen und Umsehen: linker und rechter Stick (tauschbar unter Steuerung → Controller).</p>';
      html += acts.map((a) => rowHtmlFor(a, res, dev)).join('');
    }
    return html;
  }

  /* ---------------------------------------------------------- Touch */

  function touchHtml() {
    const L = sanitizeTouchLayout(S.get('touchLayout'));
    const aspect = touchAspect();
    const R = resolveTouchLayout(L, aspect);
    const cards = Object.entries(TOUCH_PRESETS).map(([id, p]) => `
      <button type="button" class="tp-card" data-preset="${id}" aria-pressed="${L.preset === id}">
        <svg viewBox="0 0 100 46" aria-hidden="true"><rect class="tp-scr" x="1" y="1" width="98" height="44" rx="6"/>${PREVIEW[id].map(([k, x, y, r]) => `<circle class="tp-${k}" cx="${x}" cy="${(y * 0.46).toFixed(1)}" r="${(r * 0.46).toFixed(1)}"/>`).join('')}</svg>
        <b>${esc(p.label)}</b>
      </button>`).join('');
    const extra = EXTRA.map((x) => {
      const e = R.buttons[x.ids[0]] || {};
      const v = typeof e.h === 'boolean' ? (e.h ? 'aus' : 'an') : x.auto ? 'auto' : 'aus';
      const opts = x.auto ? [['auto', 'Automatisch'], ['an', 'Immer'], ['aus', 'Aus']] : [['an', 'An'], ['aus', 'Aus']];
      return `<div class="sp-row" data-tx="${x.ids.join(',')}"><div class="sp-lab"><span>${esc(x.label)}</span><small>${esc(x.hint)}</small></div><div class="sp-ctl m-seg" role="radiogroup" aria-label="${esc(x.label)}">${opts.map(([o, l]) => `<button type="button" role="radio" data-tv="${o}" aria-checked="${o === v}">${l}</button>`).join('')}</div></div>`;
    }).join('');
    const own = !!L.custom[aspect];
    return `
      <div class="tp-edit">
        <button type="button" class="m-btn m-primary" data-act="touch-edit">${ICON.layout}<span>Layout bearbeiten</span></button>
        <p>Knöpfe frei verschieben, Größe und Deckkraft je Knopf. Gespeichert für dieses Seitenverhältnis (<b>${esc(aspect)}</b>)${own ? ' – eigene Anpassungen vorhanden.' : '.'}</p>
      </div>
      <h3 class="m-h2 sp-sub">Vorlage</h3>
      <div class="tp-cards">${cards}</div>
      <h3 class="m-h2 sp-sub">Joystick</h3>
      <div class="sp-row" data-stick><div class="sp-lab"><span>Joystick</span><small>Schwebend: erscheint, wo der Daumen aufsetzt. Fest: immer an derselben Stelle.</small></div><div class="sp-ctl m-seg" role="radiogroup" aria-label="Joystick">${[['0', 'Schwebend'], ['1', 'Fest']].map(([o, l]) => `<button type="button" role="radio" data-sv="${o}" aria-checked="${String(+!!L.stick.fixed) === o}">${l}</button>`).join('')}</div></div>
      <h3 class="m-h2 sp-sub">Zusätzliche Knöpfe</h3>
      ${extra}
      <h3 class="m-h2 sp-sub">Alle Knöpfe</h3>
      ${rowHtml(P, 'touchOpacity', { hint: 'Einzelne Knöpfe im Layout-Editor.' })}
      ${rowHtml(P, 'touchButtonScale', { hint: 'Einzelne Knöpfe im Layout-Editor.' })}
      <div class="sp-linkrow"><button type="button" class="m-btn m-ghost" data-act="touch-reset"${own ? '' : ' disabled'}>${ICON.restart}<span>Eigene Lagen (${esc(aspect)}) verwerfen</span></button></div>`;
  }

  /* ---------------------------------------------------------- Aufbau */

  function render() {
    if (!host) return;
    const dev = state.device;
    const scroller = host.closest('.sp-body');
    const top = scroller ? scroller.scrollTop : 0;
    const style = padStyle(G);
    const tools = dev === 'pad'
      ? `<div class="bd-tools">${rowHtml(P, 'padIcons', { label: 'Symbole', control: 'seg' })}</div>`
      : dev === 'kb' ? '<p class="sp-tip bd-tip">Feld anklicken, dann Taste oder Maustaste drücken. Esc bricht ab. Bis zu drei Belegungen je Aktion.</p>' : '';
    host.innerHTML = `
      <nav class="sp-jump bd-devs" role="tablist" aria-label="Gerät">${DEVICES.map(([id, l, ic]) => `<button type="button" class="sp-chip" role="tab" data-dev="${id}" aria-selected="${id === dev}">${ic}<span>${l}</span></button>`).join('')}</nav>
      <div class="bd" data-dev-pane="${dev}" data-style="${style}">
        ${tools}
        ${dev === 'touch' ? touchHtml() : listHtml(dev)}
      </div>
      <div class="bd-cap" hidden role="status" aria-live="assertive"><div class="bd-cap-in"><span class="bd-cap-k"></span><b class="bd-cap-a"></b><small class="bd-cap-h"></small><small class="bd-cap-t"></small><button type="button" class="m-btn bd-cap-x" hidden>${ICON.close}<span>Abbrechen</span></button></div></div>`;
    if (scroller && top) scroller.scrollTop = top;
  }

  function refreshList() {
    if (!host || state.device === 'touch' || capturing) return;
    const res = resolved();
    const dev = state.device;
    for (const row of host.querySelectorAll('.bd-row')) {
      const a = ACTION_DEFS.find((x) => x.id === row.dataset.a);
      if (!a) continue;
      const tmp = document.createElement('div');
      tmp.innerHTML = rowHtmlFor(a, res, dev);
      const n = tmp.firstElementChild;
      if (n.outerHTML !== row.outerHTML) {
        const focusSlot = row.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.slot : null;
        row.replaceWith(n);
        if (focusSlot != null) { const f = n.querySelector(`[data-slot="${focusSlot}"]`); if (f) f.focus({ preventScroll: true }); }
      }
    }
  }

  /* ---------------------------------------------------------- Erfassen */

  async function capture(action, slot, btn, startedByTouch) {
    const input = G.input;
    if (!input || typeof input.capture !== 'function' || capturing) return;
    const dev = state.device;
    capturing = { action, slot, btn };
    const cap = host.querySelector('.bd-cap');
    host.querySelector('.bd-cap-a').textContent = actionName(action);
    host.querySelector('.bd-cap-k').textContent = dev === 'pad' ? 'Controller-Taste drücken …' : 'Taste drücken …';
    host.querySelector('.bd-cap-h').textContent = dev === 'pad'
      ? 'Zweite Taste bei gehaltener erster = Kombination (z. B. LT + L3). Menü-Taste bricht ab.'
      : startedByTouch ? 'Taste auf der Tastatur drücken. Antippen bricht ab.' : 'Taste, Maustaste oder Mausrad. Esc bricht ab.';
    host.querySelector('.bd-cap-x').hidden = !startedByTouch;
    cap.hidden = false;
    btn.classList.add('is-capturing');
    // Restzeit einmal je Sekunde (keine Dauer-Animation: über dem unscharfen Menühintergrund kostet jedes Bild viel)
    const t = host.querySelector('.bd-cap-t');
    const t0 = performance.now();
    const tick = () => { const left = Math.max(0, Math.ceil(8 - (performance.now() - t0) / 1000)); t.textContent = `Bricht in ${left} s ab`; };
    tick();
    const timer = setInterval(tick, 1000);
    // Touch: Antippen bricht ab (vor dem kompatiblen mousedown, der sonst als Maustaste erfasst würde)
    const onDown = (e) => { if (e.pointerType && e.pointerType !== 'mouse') { e.preventDefault(); e.stopPropagation(); input.cancelCapture(); } };
    window.addEventListener('pointerdown', onDown, true);
    P.sound('click');
    const code = await input.capture({ device: dev, timeout: 8000 });
    clearInterval(timer);
    window.removeEventListener('pointerdown', onDown, true);
    capturing = null;
    if (!host) return;
    cap.hidden = true;
    btn.classList.remove('is-capturing');
    P.mutePad && P.mutePad(300);
    if (!code) { P.sound('back'); refreshList(); focusSlot(action, slot); return; }
    const before = S.get('bindings');
    const res = setBinding(before, dev, action, slot, code, { conflict: 'swap' });
    if (!res.ok) { toast('Diese Taste lässt sich nicht belegen.', 'warn'); refreshList(); return; }
    S.set('bindings', res.overrides);
    P.sound('confirm');
    if (res.displaced.length) {
      const d = res.displaced[0];
      toast(`„${keyText(G, code)}“ war „${actionName(d.action)}“ zugewiesen – ${d.replacement ? `jetzt „${keyText(G, d.replacement)}“` : 'dort jetzt frei'}.`, 'info', () => S.set('bindings', before));
    } else {
      const w = codeWarning(code);
      if (w) toast(w, 'warn');
    }
    refreshList();
    focusSlot(action, slot);
  }

  function focusSlot(action, slot) {
    const b = host && host.querySelector(`.bd-row[data-a="${action}"] [data-slot="${slot}"]`);
    if (b) try { b.focus({ preventScroll: true }); } catch { /* */ }
  }

  function clearSlot(action, slot) {
    const before = S.get('bindings');
    const res = setBinding(before, state.device, action, slot, null);
    if (!res.ok) return;
    S.set('bindings', res.overrides);
    P.sound('back');
    toast(`„${actionName(action)}“: Belegung entfernt.`, 'info', () => S.set('bindings', before));
  }

  function resetAction(action) {
    const ov = S.get('bindings') || {};
    const dev = state.device;
    if (ov[dev]) { delete ov[dev][action]; if (!Object.keys(ov[dev]).length) delete ov[dev]; }
    S.set('bindings', ov);
    P.sound('back');
  }

  /* ---------------------------------------------------------- Touch-Aktionen */

  function setTouch(fn) {
    const before = S.get('touchLayout');
    const next = fn(sanitizeTouchLayout(before));
    S.set('touchLayout', next);
    if (G.input && G.input.applyTouchLayout) G.input.applyTouchLayout();
    return before;
  }

  function toast(text, tone = 'info', undo = null) {
    if (P.toast) P.toast(text, tone, undo);
  }

  function onClick(e) {
    const t = e.target;
    const devB = t.closest('[data-dev]');
    if (devB) {
      if (capturing) return;
      state.device = devB.dataset.dev;
      const sc = host.closest('.sp-body');
      if (sc) sc.scrollTop = 0;
      render();
      if (P.refreshReset) P.refreshReset();
      P.sound('click');
      const f = host.querySelector(`[data-dev="${state.device}"]`);
      if (f) f.focus({ preventScroll: true });
      return;
    }
    if (t.closest('.bd-cap-x')) { if (G.input) G.input.cancelCapture(); return; }
    if (capturing) return;
    const row = t.closest('.bd-row');
    if (row) {
      const a = row.dataset.a;
      const slotB = t.closest('[data-slot]');
      if (slotB && slotB.tagName === 'BUTTON') { capture(a, Number(slotB.dataset.slot), slotB, !!(P.pointer && P.pointer() !== 'mouse')); return; }
      const clr = t.closest('[data-clear]');
      if (clr) { clearSlot(a, Number(clr.dataset.clear)); return; }
      if (t.closest('[data-reset]')) { resetAction(a); return; }
      const mv = t.closest('[data-mv]');
      if (mv) { S.set(mv.closest('[data-mode]').dataset.mode, mv.dataset.mv); P.sound('click'); return; }
      return;
    }
    if (t.closest('[data-act="touch-edit"]')) { P.openTouchEditor(); return; }
    if (t.closest('[data-act="touch-reset"]')) {
      const aspect = touchAspect();
      const before = setTouch((L) => { delete L.custom[aspect]; return L; });
      P.sound('back');
      toast(`Eigene Lagen für ${aspect} verworfen.`, 'info', () => { S.set('touchLayout', before); G.input && G.input.applyTouchLayout && G.input.applyTouchLayout(); });
      render();
      return;
    }
    const pc = t.closest('[data-preset]');
    if (pc) {
      const id = pc.dataset.preset;
      const aspect = touchAspect();
      const before = setTouch((L) => {
        // Vorlage wechseln: eigene Lagen dieses Seitenverhältnisses verwerfen, Sichtbarkeit der Zusatzknöpfe behalten
        const keep = {};
        const R = resolveTouchLayout(L, aspect);
        for (const x of EXTRA) for (const bid of x.ids) if (R.buttons[bid] && typeof R.buttons[bid].h === 'boolean') keep[bid] = { h: R.buttons[bid].h };
        L.preset = id;
        L.stick = { ...L.stick };
        delete L.stick.side;
        delete L.custom[aspect];
        if (Object.keys(keep).length) L.custom[aspect] = keep;
        return L;
      });
      P.sound('confirm');
      toast(`Vorlage „${TOUCH_PRESETS[id].label}“.`, 'info', () => { S.set('touchLayout', before); G.input && G.input.applyTouchLayout && G.input.applyTouchLayout(); });
      render();
      return;
    }
    const sv = t.closest('[data-sv]');
    if (sv) {
      setTouch((L) => { L.stick = { ...L.stick, fixed: sv.dataset.sv === '1' }; return L; });
      P.sound('click');
      render();
      return;
    }
    const tv = t.closest('[data-tv]');
    if (tv) {
      const ids = tv.closest('[data-tx]').dataset.tx.split(',');
      const aspect = touchAspect();
      const v = tv.dataset.tv;
      setTouch((L) => {
        let out = seedAspect(L, aspect);
        for (const id of ids) {
          const cur = (out.custom[aspect] || {})[id] || {};
          const next = { ...cur };
          if (v === 'auto') delete next.h; else next.h = v === 'aus';
          out = editTouch(out, aspect, id, null);
          if (Object.keys(next).length) out = editTouch(out, aspect, id, next);
        }
        return out;
      });
      P.sound('click');
      render();
    }
  }

  return {
    keys: ['bindings', 'touchLayout', 'padIcons', 'touchOpacity', 'touchButtonScale'],
    get resetLabel() { return state.device === 'touch' ? 'Touch-Layout' : state.device === 'pad' ? 'Controller-Belegung' : 'Tastenbelegung'; },
    mount(h) {
      host = h;
      render();
      host.addEventListener('click', onClick);
      offRows = bindRows(host, P);
    },
    unmount() {
      if (capturing && G.input) G.input.cancelCapture();
      capturing = null;
      clearTimeout(toastT);
      if (host) host.removeEventListener('click', onClick);
      if (offRows) offRows();
      host = null;
    },
    sync(key) {
      if (!host) return;
      if (key === 'bindings' || key === 'adsMode' || key === 'sprintMode' || key === 'crouchMode' || key === 'leanMode') refreshList();
      else if (key === 'padIcons') render();
      else if (key === 'touchLayout' && state.device === 'touch') render();
      else syncRows(host, P, key);
    },
    reset() {
      const dev = state.device;
      if (dev === 'touch') {
        const before = S.get('touchLayout');
        S.patch({ touchLayout: null, touchOpacity: S.defaults.touchOpacity, touchButtonScale: S.defaults.touchButtonScale });
        if (G.input && G.input.applyTouchLayout) G.input.applyTouchLayout();
        toast('Touch-Layout auf Standard.', 'info', () => S.set('touchLayout', before));
      } else {
        const before = S.get('bindings');
        S.set('bindings', resetBindings(before, dev));
        toast(`${dev === 'pad' ? 'Controller' : 'Tastatur'} auf Standardbelegung.`, 'info', () => S.set('bindings', before));
      }
      render();
    },
  };
}
