// NULLPUNKT — Ausrüstungs-Tafel für das laufende Match (Todesbildschirm „Ausrüsten“, Einsatzkarte, Pausemenü
// „Ausrüstung“): Klasse (classes.data.js), Primär/Sekundär/Granate, Tarnung der gewählten Waffe (weapons.data.js CAMOS),
// Ausführung des Outfits. Touch-first (große Kacheln), per Pfeiltasten/Gamepad über die räumliche Navigation bedienbar.
// API: new LoadoutPanel(G); mount(host, loadout?) ; value() → loadout ; save() (Klassenausrüstung merken) ; unmount().

import { CLASSES, SOLDIER_CLASS_ORDER, resolveClassLoadout, classAllows, classProfile } from '../../shared/classes.data.js';
import { openCamoEditor } from './camo-editor.js';
import { OPERATOR_TIERS } from '../../shared/modes.data.js';
import { esc } from './dom.js';
import { ICON } from './icons.js';
import { ATT_SLOTS, ATTACHMENTS, attachmentsFor, loadAttachments, saveAttachment, applyAttachments } from '../../shared/attachments.data.js';
import { getWeaponModelInfo } from '../weapons/models.js';

const SLOTS = [['primary', 'Primär'], ['secondary', 'Sekundär'], ['melee', 'Messer'], ['lethal', 'Granate']];

export class LoadoutPanel {
  constructor(G) {
    this.G = G;
    this.host = null;
    this.lo = null;
    this.slot = 'primary';
    this.onChange = null;
    this._click = (e) => this._onClick(e);
    // Aufsatz geändert: speichern, Tafel neu (Werte-Vergleich), Rückmeldung an den Besitzer (Pausemenü/Einsatzkarte)
    this._change = (e) => {
      if (!onAttChange(e)) return;
      const slot = e.target.dataset.attSlot;
      this.render();
      const n = this.host && this.host.querySelector(`[data-att-slot="${slot}"]`);
      if (n) n.focus({ preventScroll: true });
      if (typeof this.onChange === 'function') this.onChange(this.value());
    };
  }

  _d() {
    const D = this.G.data || {};
    return { W: D.WEAPONS || {}, EQ: D.EQUIPMENT || {}, CAMOS: D.CAMOS || null, camoText: D.camoUnlockText, camoOk: D.isCamoUnlocked, WC: D.WEAPON_CLASSES || {} };
  }

  unlocked(id) {
    const P = this.G.profile;
    return !P || typeof P.isUnlocked !== 'function' || P.isUnlocked(id);
  }

  /** Startwert: aktuelle Ausrüstung des Spielers (bzw. übergeben), Klasse aus Match/Einstellungen. */
  mount(host, loadout = null) {
    const G = this.G;
    this.unmount();
    this.host = host;
    const p = G.player;
    const base = { ...((p && p.loadout) || G.match.loadout || {}), ...(loadout || {}) };
    const cls = CLASSES[base.cls] ? base.cls : CLASSES[G.match.cls] ? G.match.cls : CLASSES[G.settings.get('lastClass')] ? G.settings.get('lastClass') : 'sturm';
    this.lo = { ...base, cls };
    const eq = this._equipped();
    this.lo.camo = { ...(base.camo || {}), ...eq.weapon };
    this.lo.skin = eq.operator[cls] || base.skin || null;
    host.addEventListener('click', this._click);
    host.addEventListener('change', this._change);
    this.render();
  }

  unmount() {
    if (this.host) { this.host.removeEventListener('click', this._click); this.host.removeEventListener('change', this._change); this.host.innerHTML = ''; }
    this.host = null;
  }

  _equipped() {
    try { return this.G.profile.get().cosmetics.equipped; } catch { return { weapon: {}, operator: {} }; }
  }

  value() {
    const lo = this.lo || {};
    return { primary: lo.primary, secondary: lo.secondary, lethal: lo.lethal, melee: lo.melee || 'knife', cls: lo.cls, camo: { ...(lo.camo || {}) }, skin: lo.skin || null };
  }

  /** Klassenausrüstung merken (settings.classLoadouts / lastClass, core-mechanics). */
  save() {
    const S = this.G.settings;
    const v = this.value();
    try {
      const all = { ...(S.get('classLoadouts') || {}) };
      all[v.cls] = { primary: v.primary, secondary: v.secondary, lethal: v.lethal, melee: v.melee, cls: v.cls };
      S.set('classLoadouts', all);
      S.set('lastClass', v.cls);
      S.set('lastLoadout', { primary: v.primary, secondary: v.secondary, lethal: v.lethal, melee: v.melee, cls: v.cls });
    } catch { /* Einstellungen gesperrt */ }
  }

  /* ------------------------------------------------------------ Darstellung */

  render() {
    if (!this.host) return;
    const d = this._d();
    const lo = this.lo;
    const prof = classProfile(lo.cls);
    const classes = SOLDIER_CLASS_ORDER.map((id) => {
      const c = CLASSES[id];
      return `<button type="button" class="lp-cls" data-cls="${id}" aria-pressed="${id === lo.cls}"><i>${ICON[id] || ICON.user}</i><b>${esc(c.name)}</b></button>`;
    }).join('');
    const c = CLASSES[lo.cls];
    const slots = SLOTS.map(([k, label]) => {
      const def = k === 'lethal' ? d.EQ[lo[k]] : d.W[k === 'melee' ? lo.melee || 'knife' : lo[k]];
      return `<button type="button" class="m-tab lp-slot" role="tab" data-lslot="${k}" aria-selected="${k === this.slot}"><small>${label}</small><span>${esc(def ? def.name : '—')}</span></button>`;
    }).join('');
    let items = '';
    if (this.slot === 'lethal') {
      items = Object.values(d.EQ).filter((x) => !x.kind || x.kind === 'lethal').map((x) => this._item(x, x.id === lo.lethal, true, '')).join('');
    } else {
      for (const w of Object.values(d.W)) {
        if (w.slot !== this.slot) continue;
        const ok = this.slot === 'melee' || classAllows(lo.cls, w.cls);
        const on = w.id === (this.slot === 'melee' ? lo.melee || 'knife' : lo[this.slot]);
        items += this._item(w, on, ok, ok ? (this.slot === 'melee' ? (w.special ? 'Nahkampf' : 'Messer') : d.WC[w.cls] || w.cls) : `Nicht für ${c.name}`);
      }
    }
    const wid = this.slot === 'lethal' ? null : this.slot === 'melee' ? lo.melee || 'knife' : lo[this.slot];
    this.host.innerHTML = `
      <div class="lp">
        <div class="lp-classes" role="group" aria-label="Klasse">${classes}</div>
        <p class="lp-role"><b>${esc(c.name)}</b> · ${esc(c.role)} <span class="lp-armor">${ICON.plate}${esc(prof.armorLabel || '')} · ${prof.plates || 0} Platten</span></p>
        <div class="lp-slots m-tabs" role="tablist">${slots}</div>
        <div class="lp-items m-scroll" data-scrollable role="listbox">${items}</div>
        ${wid ? this._camoRow(wid) : ''}${wid ? attRowHtml(this.G, wid) : ''}
        ${this._skinRow()}
      </div>`;
  }

  _item(def, on, ok, sub) {
    const locked = !this.unlocked(def.id);
    const dis = locked || !ok;
    const why = locked ? (def.og ? 'Nur Spieler der ersten Stunde' : `Ab Stufe ${def.unlockLevel || '?'}`) : sub;
    return `<button type="button" class="lp-item${on ? ' is-on' : ''}${dis ? ' is-locked' : ''}" data-item="${esc(def.id)}" role="option" aria-selected="${on}"${dis ? ' aria-disabled="true"' : ''}>
      <span class="ico">${def.icon || ''}</span><b>${esc(def.name)}</b><small>${esc(why || '')}</small>${locked ? `<i class="lk">${ICON.lock}</i>` : on ? `<i class="ok">${ICON.check}</i>` : ''}</button>`;
  }

  /** Tarnungen der Waffe (arsenal: CAMOS + isCamoUnlocked/camoUnlockText). */
  _camoRow(wid) {
    return camoRowHtml(this.G, wid, this.lo.camo && this.lo.camo[wid]);
  }

  /** Ausführung des Outfits je Klasse (Standard/Veteran/Elite, Freischaltung nach Stufe). */
  _skinRow() {
    const lo = this.lo;
    let lvl = 1;
    try { lvl = this.G.profile.get().level || 1; } catch { /* */ }
    const cur = lo.skin || `${lo.cls}:standard`;
    const btns = OPERATOR_TIERS.map((t) => {
      const id = `${lo.cls}:${t.id}`;
      const ok = lvl >= t.level;
      return `<button type="button" class="lp-skin${cur === id ? ' is-on' : ''}${ok ? '' : ' is-locked'}" data-skin="${id}" aria-pressed="${cur === id}"${ok ? '' : ' aria-disabled="true"'}><b>${esc(t.name)}</b><small>${ok ? esc(t.text) : `Ab Stufe ${t.level}`}</small></button>`;
    }).join('');
    return `<div class="lp-row"><span class="lp-lab">${ICON.user}Outfit</span><div class="lp-skins">${btns}</div></div>`;
  }

  /* ------------------------------------------------------------ Eingaben */

  _onClick(e) {
    const b = e.target.closest('button');
    if (!b || !this.host || !this.host.contains(b)) return;
    const ds = b.dataset;
    const G = this.G;
    const d = this._d();
    const snd = (n) => G.events.emit('ui:sound', { name: n });
    if (ds.cls && CLASSES[ds.cls]) {
      const saved = (G.settings.get('classLoadouts') || {})[ds.cls] || null;
      const r = resolveClassLoadout(ds.cls, { weapons: d.W, equipment: d.EQ, isUnlocked: (id) => this.unlocked(id), base: saved });
      Object.assign(this.lo, { cls: r.cls, primary: r.primary || this.lo.primary, secondary: r.secondary || this.lo.secondary, lethal: r.lethal || this.lo.lethal, armor: r.armor, helmet: r.helmet });
      this.lo.skin = this._equipped().operator[r.cls] || null;
      snd('confirm');
    } else if (ds.lslot) { this.slot = ds.lslot; snd('click'); }
    else if (ds.item) {
      if (b.getAttribute('aria-disabled') === 'true') { snd('error'); return; }
      const slot = this.slot;
      this.lo[slot] = ds.item;   // 'melee': Messer/Nahkampfwaffe
      snd('confirm');
    } else if (ds.camoedit) {
      openCamoEditor({ onClose: (changed) => { if (changed) { this.render(); if (typeof this.onChange === 'function') this.onChange(this.value()); } } });
      snd('click');
      return;
    } else if (ds.camo) {
      if (b.getAttribute('aria-disabled') === 'true') { snd('error'); return; }
      const wid = this.lo[this.slot];
      this.lo.camo = { ...(this.lo.camo || {}), [wid]: ds.camo };
      const dc = d.CAMOS && d.CAMOS[ds.camo];
      try { G.profile.equipCosmetic('weapon', wid, dc && dc.unlock && dc.unlock.type === 'default' ? null : ds.camo); } catch { /* */ }
      snd('confirm');
    } else if (ds.skin) {
      if (b.getAttribute('aria-disabled') === 'true') { snd('error'); return; }
      this.lo.skin = ds.skin;
      try { G.profile.equipCosmetic('operator', this.lo.cls, ds.skin.endsWith(':standard') ? null : ds.skin); } catch { /* */ }
      snd('confirm');
    } else return;
    const focusKey = Object.entries(ds)[0];
    this.render();
    if (focusKey) { const n = this.host.querySelector(`[data-${focusKey[0].replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}="${focusKey[1]}"]`); if (n) n.focus({ preventScroll: true }); }
    if (typeof this.onChange === 'function') this.onChange(this.value());
  }
}

/** Freischalt-Kontext einer Waffe für isCamoUnlocked (Stufe, Abschüsse/Kopftreffer mit der Waffe, freie Muster). */
export function camoCtx(G, wid) {
  const D = G.data || {};
  let prof = null;
  try { prof = G.profile.get(); } catch { /* */ }
  const ws = (prof && prof.weaponStats && prof.weaponStats[wid]) || {};
  const ctx = { level: (prof && prof.level) || 1, kills: ws.kills | 0, headshots: ws.headshots | 0, og: !!(prof && prof.og), unlocked: [] };
  if (D.CAMOS && typeof D.isCamoUnlocked === 'function') ctx.unlocked = Object.keys(D.CAMOS).filter((id) => D.CAMOS[id].unlock && D.CAMOS[id].unlock.type !== 'mastery' && D.isCamoUnlocked(id, ctx));
  return ctx;
}

/** Tarnungszeile (Knöpfe data-camo) für Waffe `wid`; cur = ausgerüstete Tarnung (sonst Standard). '' ohne CAMOS. */
export function camoRowHtml(G, wid, cur) {
  const D = G.data || {};
  if (!D.CAMOS || !wid) return '';
  const ctx = camoCtx(G, wid);
  const all = Object.values(D.CAMOS).filter((cm) => typeof D.camoVisible !== 'function' || D.camoVisible(cm.id, ctx));
  const def = (all.find((x) => !x.unlock || x.unlock.type === 'default') || all[0] || {}).id;
  const sel = (cur && D.CAMOS[cur] && cur) || def;
  const list = all.map((cm) => {
    const ok = typeof D.isCamoUnlocked === 'function' ? D.isCamoUnlocked(cm.id, ctx) : true;
    const tip = ok ? cm.name : `${cm.name} – ${typeof D.camoUnlockText === 'function' ? D.camoUnlockText(cm.id) : 'gesperrt'}`;
    return `<button type="button" class="lp-camo${sel === cm.id ? ' is-on' : ''}${ok ? '' : ' is-locked'}" data-camo="${esc(cm.id)}" title="${esc(tip)}" aria-label="${esc(tip)}" aria-pressed="${sel === cm.id}"${ok ? '' : ' aria-disabled="true"'}><i style="background:${swatch(cm)}"></i>${ok ? '' : ICON.lock}</button>`;
  }).join('');
  const name = (D.CAMOS[sel] && D.CAMOS[sel].name) || '';
  const n = all.filter((cm) => typeof D.isCamoUnlocked !== 'function' || D.isCamoUnlocked(cm.id, ctx)).length;
  // Spieler der ersten Stunde: eigene Muster entwerfen (game/ui/camo-editor.js)
  const edit = ctx.og ? `<button type="button" class="lp-camo lp-camo-edit" data-camoedit="1" title="Eigene Tarnung entwerfen" aria-label="Eigene Tarnung entwerfen"><i style="background:#1b1e22;display:grid;place-items:center;color:#e9b949;font-weight:700">+</i></button>` : '';
  return `<div class="lp-row"><span class="lp-lab">${ICON.palette}Tarnung <b>${esc(name)}</b><small>${n}/${all.length} frei</small></span><div class="lp-camos m-scroll-x" data-scrollable>${list}${edit}</div></div>`;
}

/** Ausgerüstete Tarnung einer Waffe aus dem Profil. */
export function equippedCamo(G, wid) {
  try { return G.profile.get().cosmetics.equipped.weapon[wid] || null; } catch { return null; }
}

/** CSS-Hintergrund für eine Tarnungsvorschau. */
export function swatch(cm) {
  const c = cm && cm.colors && cm.colors.length ? cm.colors : ['#3a3d40', '#2a2d30'];
  if (c.length === 1) return c[0];
  const step = 100 / c.length;
  if (cm.pattern === 'stripes' || cm.pattern === 'tiger') return `repeating-linear-gradient(115deg, ${c.map((x, i) => `${x} ${i * 9}px ${(i + 1) * 9}px`).join(', ')})`;
  if (cm.pattern === 'digital' || cm.pattern === 'hex' || cm.pattern === 'carbon') return `conic-gradient(${c.map((x, i) => `${x} ${i * step}% ${(i + 1) * step}%`).join(', ')})`;
  return `radial-gradient(circle at 30% 35%, ${c[0]} 0 26%, transparent 27%), radial-gradient(circle at 72% 68%, ${c[2 % c.length]} 0 22%, transparent 23%), linear-gradient(135deg, ${c[1]}, ${c[c.length - 1]})`;
}

/** Aufsätze einer Waffe (shared/attachments.data.js): je passendem Platz eine Auswahl; gespeichert im Browser. */
export function attRowHtml(G, wid) {
  const def = G.data && G.data.WEAPONS && G.data.WEAPONS[wid];
  if (!def) return '';
  let info = null;
  try { info = getWeaponModelInfo(def.model || wid); } catch { /* */ }
  const fit = attachmentsFor(def, info);
  const cur = loadAttachments()[wid] || {};
  const rows = ATT_SLOTS.filter((s) => fit[s.id]).map((s) => {
    const opts = [`<option value="">Standard</option>`, ...fit[s.id].map((id) => `<option value="${esc(id)}"${cur[s.id] === id ? ' selected' : ''}>${esc(ATTACHMENTS[id].name)}</option>`)].join('');
    const a = ATTACHMENTS[cur[s.id]];
    return `<label class="lp-att"><span>${esc(s.name)}</span><select data-att-w="${esc(wid)}" data-att-slot="${esc(s.id)}" title="${esc(a ? a.kurz : 'Werkszustand')}">${opts}</select><small>${esc(a ? a.kurz : '')}</small></label>`;
  }).join('');
  if (!rows) return '';
  const n = Object.keys(cur).filter((k) => fit[k] && fit[k].includes(cur[k])).length;
  return `<div class="lp-row lp-atts"><span class="lp-lab">Aufsätze <b>${n}</b><small>im Match sofort (Pause → Ausrüstung)</small></span><div class="lp-attgrid">${rows}</div>${attStatsHtml(def, applyAttachments(def, cur, info))}</div>`;
}

/** Werte mit Aufsätzen gegen die Grundwaffe (nur Änderungen; grün = besser, rot = schlechter). */
export function attStatsHtml(base, mod) {
  if (!base || !mod || mod === base) return '<p class="lp-attnone">Werkszustand – Aufsätze ändern Schaden, Rückstoß, Anschlag, Streuung, Magazin, Nachladen, Reichweite und Durchschlag.</p>';
  const pct = (a, b) => `${b > a ? '+' : '−'}${Math.round(Math.abs(b / a - 1) * 100)} %`;
  const num = (v, k = 0) => v.toLocaleString('de-DE', { maximumFractionDigits: k, minimumFractionDigits: k });
  const rows = [];
  const add = (label, a, b, better, fmt) => { if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b - a) < 1e-9) return; rows.push(`<span class="${(better ? b > a : b < a) ? 'up' : 'down'}">${esc(label)} <b>${fmt(a, b)}</b></span>`); };
  add('Schaden', base.damage.max, mod.damage.max, true, (a, b) => `${a} → ${b}`);
  if (mod.pellets !== base.pellets) rows.push(`<span class="up">Geschoss <b>${base.pellets} Schrot → 1 Kugel</b></span>`);
  add('Reichweite', base.damage.rangeEnd, mod.damage.rangeEnd, true, (a, b) => `${num(a)} → ${num(b)} m`);
  add('Hochschlag', base.recoil.vertical, mod.recoil.vertical, false, pct);
  add('Seitenrückstoß', base.recoil.horizontal, mod.recoil.horizontal, false, pct);
  add('Anschlag', base.adsTime, mod.adsTime, false, (a, b) => `${num(a, 2)} → ${num(b, 2)} s`);
  add('Hüftstreuung', base.hipSpread, mod.hipSpread, false, pct);
  add('Magazin', base.mag, mod.mag, true, (a, b) => `${a} → ${b}`);
  add('Nachladen', base.reloadTime, mod.reloadTime, false, (a, b) => `${num(a, 1)} → ${num(b, 1)} s`);
  add('Durchschlag', base.penetration || 0, mod.penetration || 0, true, (a, b) => `${num(a, 2)} → ${num(b, 2)}`);
  add('Laufen', base.moveSpeedMult, mod.moveSpeedMult, true, pct);
  add('Aus dem Sprint', base.sprintToFire, mod.sprintToFire, false, pct);
  add('Zoom', base.adsZoom, mod.adsZoom, true, (a, b) => `${num(a, 2)}× → ${num(b, 2)}×`);
  if (mod.suppressed && !base.suppressed) rows.push(`<span class="up">Gedämpft <b>leise, nicht auf der Karte</b></span>`);
  if (mod.bipod) rows.push(`<span class="up">Zweibein <b>geduckt −${Math.round((1 - mod.bipod) * 100)} % Rückstoß</b></span>`);
  return rows.length ? `<div class="lp-attstats">${rows.join('')}</div>` : '';
}

/** Auswahl geändert (delegiert an Tafel/Lobby). */
export function onAttChange(e) {
  const el = e.target;
  if (!el || !el.dataset || !el.dataset.attSlot) return false;
  saveAttachment(el.dataset.attW, el.dataset.attSlot, el.value || null);
  const a = ATTACHMENTS[el.value];
  const sm = el.parentElement && el.parentElement.querySelector('small');
  if (sm) sm.textContent = a ? a.kurz : '';
  el.title = a ? a.kurz : 'Werkszustand';
  return true;
}
