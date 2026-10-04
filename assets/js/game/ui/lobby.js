// NULLPUNKT — Lobby: Einsatz (Modus-Karten, Kartenwahl mit Vorschau, Schwierigkeit, Teamgrößen mit Ausgleich)
// und Ausrüstung (Primär/Sekundär/Granate mit Werte-Balken aus computeStats, Vergleich, Stufen-Sperren,
// Vorlagen, 3D-Vorschau). Vorbelegung aus URL-Parametern (erster Aufruf) und den letzten Einstellungen.

import { esc, num, secs, meters } from './dom.js';
import { ICON } from './icons.js';
import { drawMapArt } from './mapart.js';

const DIFF_ORDER = ['rekrut', 'regulaer', 'veteran', 'elite'];
const STAT_LABELS = [['damage', 'Schaden'], ['fireRate', 'Kadenz'], ['range', 'Reichweite'], ['accuracy', 'Präzision'], ['mobility', 'Mobilität'], ['control', 'Kontrolle']];
const MAP_PREP = { hafen: 'im', altstadt: 'in der', werk: 'im', range: 'am' };

export class Lobby {
  constructor(menus) {
    this.menus = menus;
    this.G = menus.G;
    this.cfg = null;
    this.tab = 'deploy';
    this.slot = 'primary';
    this.view = null; // aktuell betrachtete Waffe (Ausrüstung)
    this.el = null;
    this._paramsUsed = false;
  }

  /* ------------------------------------------------------------ Daten */

  _data() {
    const D = this.G.data || {};
    return {
      MODES: D.MODES || {}, ORDER: (D.MODE_ORDER || Object.keys(D.MODES || {})).filter((m) => (D.MODES || {})[m]),
      MAPS: D.MAPS || {}, MAP_ORDER: D.MAP_ORDER || Object.keys(D.MAPS || {}), W: D.WEAPONS || {}, EQ: D.EQUIPMENT || {},
      DIFF: D.DIFFICULTIES || {}, LOADOUTS: D.DEFAULT_LOADOUTS || [], CLASSES: D.WEAPON_CLASSES || {}, CLASS_ORDER: D.CLASS_ORDER || [],
      SIGHTS: D.SIGHTS || {}, FIRE: D.FIRE_MODES || {}, ttk: D.ttk, effectiveRange: D.effectiveRange, STREAKS: D.STREAKS || {},
    };
  }

  level() {
    try { return this.G.profile.get().level || 1; } catch { return 1; }
  }

  unlocked(id) {
    const P = this.G.profile;
    if (P && typeof P.isUnlocked === 'function') return P.isUnlocked(id);
    const d = this._data();
    const def = d.W[id] || d.EQ[id];
    return !def || (def.unlockLevel || 1) <= this.level();
  }

  /** Konfiguration aus URL (einmalig) bzw. letzten Einstellungen. */
  _initCfg() {
    const G = this.G;
    const S = G.settings;
    const d = this._data();
    const prm = !this._paramsUsed ? G.params : null;
    this._paramsUsed = true;
    const pick = (v, table, fb) => (v && table[v] ? v : fb);
    const last = S.get('lastLoadout') || {};
    const base = this.cfg || {
      modeId: pick(S.get('lastMode'), d.MODES, d.ORDER[0] || 'tdm'),
      mapId: pick(S.get('lastMap'), d.MAPS, d.MAP_ORDER[0] || 'hafen'),
      difficulty: DIFF_ORDER.includes(S.get('difficulty')) ? S.get('difficulty') : 'regulaer',
      allies: null, enemies: null, balance: true,
      primary: last.primary, secondary: last.secondary, lethal: last.lethal,
    };
    if (prm) {
      if (d.MODES[prm.get('mode')]) base.modeId = prm.get('mode');
      if (d.MAPS[prm.get('map')]) base.mapId = prm.get('map');
      if (DIFF_ORDER.includes(prm.get('diff'))) base.difficulty = prm.get('diff');
      const a = parseInt(prm.get('allies'), 10);
      const e = parseInt(prm.get('enemies'), 10);
      if (Number.isFinite(a)) { base.allies = a; base.balance = false; }
      if (Number.isFinite(e)) base.enemies = e;
      for (const k of ['primary', 'secondary']) if (d.W[prm.get(k)]) base[k] = prm.get(k);
      if (d.EQ[prm.get('lethal')]) base.lethal = prm.get('lethal');
    }
    // Ausrüstung validieren (Slot + Freischaltung)
    const okW = (id, slot) => id && d.W[id] && d.W[id].slot === slot && this.unlocked(id);
    const def = d.LOADOUTS[0] || { primary: 'ar_m17', secondary: 'pi_p9', lethal: 'frag' };
    if (!okW(base.primary, 'primary')) base.primary = def.primary;
    if (!okW(base.secondary, 'secondary')) base.secondary = def.secondary;
    if (!base.lethal || !d.EQ[base.lethal] || !this.unlocked(base.lethal)) base.lethal = def.lethal;
    this.cfg = base;
    this._fixMode();
  }

  _fixMode() {
    const d = this._data();
    const c = this.cfg;
    const m = d.MODES[c.modeId] || {};
    const maps = this.mapsFor(c.modeId);
    if (!maps.includes(c.mapId)) c.mapId = (m.recommendedMaps || []).find((x) => maps.includes(x)) || maps[0] || c.mapId;
    const lim = m.limits || { allies: [0, 7], enemies: [1, 8] };
    const teams = m.teams !== false;
    if (!Number.isFinite(c.enemies) || c.enemies == null) c.enemies = m.defaultEnemies ?? (teams ? 6 : 7);
    c.enemies = clampInt(c.enemies, lim.enemies[0], lim.enemies[1]);
    if (!teams) c.allies = 0;
    else {
      if (c.balance || !Number.isFinite(c.allies) || c.allies == null) c.allies = c.balance ? c.enemies - 1 : m.defaultAllies ?? 5;
      c.allies = clampInt(c.allies, lim.allies[0], lim.allies[1]);
    }
  }

  mapsFor(modeId) {
    const d = this._data();
    const ids = d.MAP_ORDER.filter((id) => d.MAPS[id]);
    const list = ids.filter((id) => Array.isArray(d.MAPS[id].modes) && d.MAPS[id].modes.includes(modeId));
    if (list.length) return list;
    if (modeId === 'training') return ids.filter((id) => id === 'range');
    return ids.filter((id) => id !== 'range');
  }

  /** Startkonfiguration für main (onStart). */
  config() {
    const c = this.cfg;
    return {
      modeId: c.modeId, mapId: c.mapId, difficulty: c.difficulty, allies: c.allies, enemies: c.enemies,
      loadout: { primary: c.primary, secondary: c.secondary, lethal: c.lethal },
    };
  }

  /* ------------------------------------------------------------ Aufbau */

  mount(screen) {
    this._initCfg();
    const G = this.G;
    const prof = G.profile.get();
    const P = G.profile;
    const rank = P.rankFor ? P.rankFor(prof.level) : { name: '' };
    const prog = P.levelProgress ? P.levelProgress(prof.xp) : { progress: 0, xpIntoLevel: 0, xpForNext: 0, isMax: false };
    screen.innerHTML = `
      <div class="lb">
        <header class="lb-head">
          <div class="lb-brand">NULL<em>PUNKT</em><i>.</i></div>
          <div class="lb-tabs m-tabs" role="tablist">
            <button type="button" class="m-tab" role="tab" data-tab="deploy" aria-selected="${this.tab === 'deploy'}">${ICON.map}<span>Einsatz</span></button>
            <button type="button" class="m-tab" role="tab" data-tab="loadout" aria-selected="${this.tab === 'loadout'}">${ICON.target}<span>Ausrüstung</span></button>
          </div>
          <div class="lb-profile" title="${esc(prof.name)}">
            <span class="lb-rank">${P.rankIcon ? P.rankIcon(prof.level, { size: 30 }) : ''}</span>
            <span class="lb-pinfo"><b>${esc(prof.name)}</b><small>Stufe ${prof.level} · ${esc(rank.name)}</small><i class="lb-xp"><u style="transform:scaleX(${(prog.progress || 0).toFixed(3)})"></u></i></span>
          </div>
          <div class="lb-tools">
            <button type="button" class="m-icon" data-act="settings" aria-label="Einstellungen" title="Einstellungen">${ICON.gear}</button>
            <button type="button" class="m-icon" data-act="controls" aria-label="Steuerung" title="Steuerung">${ICON.pad}</button>
            <button type="button" class="m-icon" data-act="exit" aria-label="Zur Website" title="Zur Website">${ICON.exit}</button>
          </div>
        </header>
        <div class="lb-main">
          <div class="lb-pane m-scroll" data-scrollable data-pane="deploy"${this.tab === 'deploy' ? '' : ' hidden'}></div>
          <div class="lb-pane lb-pane-loadout" data-pane="loadout"${this.tab === 'loadout' ? '' : ' hidden'}></div>
          <aside class="lb-side">
            <div class="lb-stage" aria-label="Waffenvorschau – ziehen zum Drehen"><div class="lb-stage-name"></div><div class="lb-stage-hint">Ziehen zum Drehen</div></div>
            <div class="lb-kit"></div>
          </aside>
        </div>
        <footer class="lb-foot">
          <div class="lb-summary"></div>
          <button type="button" class="m-btn m-primary lb-start" data-act="start">${ICON.play}<span>Einsatz starten<em>.</em></span></button>
        </footer>
      </div>`;
    this.el = {
      screen, deploy: screen.querySelector('[data-pane="deploy"]'), loadout: screen.querySelector('[data-pane="loadout"]'),
      stage: screen.querySelector('.lb-stage'), stageName: screen.querySelector('.lb-stage-name'), kit: screen.querySelector('.lb-kit'),
      summary: screen.querySelector('.lb-summary'), side: screen.querySelector('.lb-side'),
    };
    screen.addEventListener('click', (e) => this._click(e));
    this._renderDeploy();
    this._renderLoadout();
    this._renderKit();
    this._renderSummary();
    this._syncTab();
  }

  _click(e) {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const c = this.cfg;
    const ds = b.dataset;
    if (ds.tab) { this.tab = ds.tab; this._syncTab(); return; }
    if (ds.mode) { c.modeId = ds.mode; this._fixMode(); this._renderDeploy(); this._renderSummary(); this._renderKit(); this.menus.sound('click'); return; }
    if (ds.map) { c.mapId = ds.map; this._renderDeploy(); this._renderSummary(); this.menus.sound('click'); return; }
    if (ds.diff) { c.difficulty = ds.diff; this._renderDeploy(); this._renderSummary(); this.menus.sound('click'); return; }
    if (ds.step) { this._step(ds.step, Number(ds.d)); return; }
    if (ds.balance != null) { c.balance = !c.balance; this._fixMode(); this._renderDeploy(); this._renderSummary(); this.menus.sound('toggle'); return; }
    if (ds.slot) { this.slot = ds.slot; this.view = c[this.slot]; this._renderLoadout(); this._showView(); this.menus.sound('click'); return; }
    if (ds.weapon) { this._choose(ds.weapon); return; }
    if (ds.preset) { this._preset(ds.preset); return; }
  }

  _syncTab() {
    const s = this.el.screen;
    s.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === this.tab)));
    this.el.deploy.hidden = this.tab !== 'deploy';
    this.el.loadout.hidden = this.tab !== 'loadout';
    s.querySelector('.lb').dataset.tab = this.tab;
    if (this.tab === 'loadout') { this.view = this.view || this.cfg[this.slot]; this._showView(); }
    else this._showView(this.cfg.primary);
    requestAnimationFrame(() => this._drawMaps());
  }

  _step(which, d) {
    const c = this.cfg;
    const m = this._data().MODES[c.modeId] || {};
    const lim = m.limits || { allies: [0, 7], enemies: [1, 8] };
    if (which === 'enemies') {
      c.enemies = clampInt(c.enemies + d, lim.enemies[0], lim.enemies[1]);
      if (c.balance && m.teams !== false) c.allies = clampInt(c.enemies - 1, lim.allies[0], lim.allies[1]);
    } else {
      c.allies = clampInt(c.allies + d, lim.allies[0], lim.allies[1]);
      c.balance = c.allies === c.enemies - 1;
    }
    this._renderTeams();
    this._renderSummary();
    this.menus.sound('click');
  }

  /* ------------------------------------------------------------ Einsatz */

  _renderDeploy() {
    const d = this._data();
    const c = this.cfg;
    const m = d.MODES[c.modeId] || {};
    const maps = this.mapsFor(c.modeId);
    const diff = d.DIFF[c.difficulty] || {};
    const modes = d.ORDER.map((id) => {
      const x = d.MODES[id];
      return `<button type="button" class="lb-mode" data-mode="${id}" aria-pressed="${id === c.modeId}">
        <span class="lb-mode-ico">${x.icon || ''}</span><span class="lb-mode-short">${esc(x.short || id.toUpperCase())}</span>
        <b>${esc(x.name)}</b><small>${esc(x.tagline || '')}</small></button>`;
    }).join('');
    const mapCards = maps.map((id) => {
      const x = d.MAPS[id];
      return `<button type="button" class="lb-map" data-map="${id}" aria-pressed="${id === c.mapId}">
        <canvas class="lb-map-art" data-art="${id}"></canvas>
        <span class="lb-map-txt"><b>${esc(x.name)}</b><small>${esc(x.timeOfDay || x.subtitle || '')}</small></span></button>`;
    }).join('');
    const diffs = DIFF_ORDER.filter((id) => d.DIFF[id] || true).map((id) => `<button type="button" role="radio" data-diff="${id}" aria-checked="${id === c.difficulty}">${esc((d.DIFF[id] && d.DIFF[id].name) || id)}</button>`).join('');
    const xpm = diff.xpMult && diff.xpMult !== 1 ? `XP ×${num(diff.xpMult, 2).replace(/,?0+$/, '')}` : 'XP ×1';
    const rules = (m.rules || []).slice(0, 5).map((r) => `<li>${esc(r)}</li>`).join('');
    this.el.deploy.innerHTML = `
      <section class="lb-sec"><h2 class="m-h2">Modus</h2><div class="lb-modes" role="group" aria-label="Modus">${modes}</div>
        <div class="lb-modeinfo"><p>${esc(m.description || '')}</p>${rules ? `<ul class="lb-rules">${rules}</ul>` : ''}</div></section>
      <section class="lb-sec"><h2 class="m-h2">Karte</h2><div class="lb-maps" role="group" aria-label="Karte">${mapCards}</div></section>
      <section class="lb-sec lb-row2">
        <div><h2 class="m-h2">Gegnerstärke</h2><div class="m-seg lb-diff" role="radiogroup" aria-label="Gegnerstärke">${diffs}</div>
          <p class="lb-note">${esc(diff.description || '')} <b>${xpm}</b></p></div>
        <div class="lb-teams"></div>
      </section>`;
    this._renderTeams();
    requestAnimationFrame(() => this._drawMaps());
  }

  _renderTeams() {
    const d = this._data();
    const c = this.cfg;
    const m = d.MODES[c.modeId] || {};
    const host = this.el.deploy.querySelector('.lb-teams');
    if (!host) return;
    const teams = m.teams !== false;
    const lim = m.limits || { allies: [0, 7], enemies: [1, 8] };
    if (c.modeId === 'training' || (lim.enemies[1] === 0)) {
      host.innerHTML = `<h2 class="m-h2">Bahnen</h2><p class="lb-note">Allein am Stand. Unbegrenzte Munition, jede Waffe frei wählbar, Bestzeiten im Parcours.</p>`;
      return;
    }
    const stepper = (k, label, v, min, max) => `
      <div class="lb-step"><span>${label}</span>
        <button type="button" class="m-icon" data-step="${k}" data-d="-1" aria-label="${label} verringern"${v <= min ? ' disabled' : ''}>${ICON.minus}</button>
        <b>${v}</b>
        <button type="button" class="m-icon" data-step="${k}" data-d="1" aria-label="${label} erhöhen"${v >= max ? ' disabled' : ''}>${ICON.plusSmall}</button></div>`;
    host.innerHTML = `<h2 class="m-h2">${teams ? 'Teams' : 'Spieler'}</h2>
      ${teams ? stepper('allies', 'Verbündete', c.allies, lim.allies[0], lim.allies[1]) : ''}
      ${stepper('enemies', teams ? 'Gegner' : 'Gegner (Bots)', c.enemies, lim.enemies[0], lim.enemies[1])}
      ${teams ? `<button type="button" class="lb-bal" data-balance aria-pressed="${!!c.balance}"><i class="m-check">${ICON.check}</i>Teams ausgleichen</button>` : ''}
      <p class="lb-note">${teams ? `${c.allies + 1} gegen ${c.enemies}${c.allies + 1 !== c.enemies ? ' – das kleinere Team kommt schneller zurück.' : '.'}` : `${c.enemies + 1} Spieler, jeder für sich.`}</p>`;
  }

  _drawMaps() {
    const d = this._data();
    if (!this.el || !this.el.deploy) return;
    this.el.deploy.querySelectorAll('canvas[data-art]').forEach((cv) => {
      if (cv.offsetParent) drawMapArt(cv, d.MAPS[cv.dataset.art]);
    });
  }

  _renderSummary() {
    const d = this._data();
    const c = this.cfg;
    const m = d.MODES[c.modeId] || {};
    const map = d.MAPS[c.mapId] || {};
    const prep = MAP_PREP[c.mapId] || 'auf';
    const diff = d.DIFF[c.difficulty] || {};
    let who;
    if (c.modeId === 'training') who = 'Allein am Stand';
    else if (m.teams !== false) who = `${c.allies + 1} gegen ${c.enemies}`;
    else who = `${c.enemies + 1} Spieler`;
    this.el.summary.innerHTML = `<small>${esc(m.short || '')} · ${esc(prep)} ${esc(map.name || c.mapId)}</small><b>${esc(m.name || c.modeId)}</b><span>${esc(who)}${c.modeId === 'training' ? '' : ` · ${esc(diff.name || c.difficulty)}`}</span>`;
  }

  /* ------------------------------------------------------------ Ausrüstung */

  _renderLoadout() {
    const d = this._data();
    const c = this.cfg;
    const lvl = this.level();
    const slots = [['primary', 'Primär', d.W[c.primary]], ['secondary', 'Sekundär', d.W[c.secondary]], ['lethal', 'Granate', d.EQ[c.lethal]]];
    let list = '';
    if (this.slot === 'lethal') {
      list = Object.values(d.EQ).map((x) => this._item(x, x.id === c.lethal, lvl, 'Ausrüstung')).join('');
    } else {
      const ws = Object.values(d.W).filter((w) => w.slot === this.slot);
      const order = d.CLASS_ORDER.length ? d.CLASS_ORDER : [...new Set(ws.map((w) => w.cls))];
      for (const cls of order) {
        const g = ws.filter((w) => w.cls === cls);
        if (!g.length) continue;
        list += `<div class="lo-cls">${esc(d.CLASSES[cls] || cls)}</div>${g.map((w) => this._item(w, w.id === c[this.slot], lvl, d.CLASSES[w.cls])).join('')}`;
      }
    }
    const presets = d.LOADOUTS.map((l) => {
      const locked = (l.unlockLevel || 1) > lvl;
      const active = l.primary === c.primary && l.secondary === c.secondary && l.lethal === c.lethal;
      return `<button type="button" class="lo-preset" data-preset="${esc(l.id)}" aria-pressed="${active}"${locked ? ' disabled' : ''} title="${esc(l.description || '')}">${locked ? ICON.lock : ''}${esc(l.name)}${locked ? `<small>Stufe ${l.unlockLevel}</small>` : ''}</button>`;
    }).join('');
    this.el.loadout.innerHTML = `
      <div class="lo">
        <div class="lo-slots m-tabs" role="tablist">${slots.map(([k, l, def]) => `<button type="button" class="m-tab lo-slot" role="tab" data-slot="${k}" aria-selected="${k === this.slot}"><small>${l}</small><span>${esc(def ? def.name : '—')}</span></button>`).join('')}</div>
        <div class="lo-body">
          <div class="lo-list m-scroll" data-scrollable role="listbox" aria-label="Waffen">${list}</div>
          <div class="lo-detail m-scroll" data-scrollable></div>
        </div>
        <div class="lo-presets"><span class="m-h2">Vorlagen</span><div class="lo-presets-row m-scroll-x" data-scrollable>${presets}</div></div>
      </div>`;
    this._renderDetail();
  }

  _item(def, equipped, lvl, cls) {
    const locked = !this.unlocked(def.id);
    const viewing = def.id === this.view;
    return `<button type="button" class="lo-item${equipped ? ' is-eq' : ''}${viewing ? ' is-view' : ''}${locked ? ' is-locked' : ''}" data-weapon="${esc(def.id)}" role="option" aria-selected="${equipped}">
      <span class="lo-ico">${def.icon || ''}</span><span class="lo-name"><b>${esc(def.name)}</b><small>${locked ? `Ab Stufe ${def.unlockLevel}` : esc(cls || '')}</small></span>
      ${locked ? `<span class="lo-lock">${ICON.lock}</span>` : equipped ? `<span class="lo-eq">${ICON.check}</span>` : ''}</button>`;
  }

  _renderDetail() {
    const d = this._data();
    const c = this.cfg;
    const host = this.el.loadout.querySelector('.lo-detail');
    if (!host) return;
    const id = this.view || c[this.slot];
    const def = d.W[id] || d.EQ[id];
    if (!def) { host.innerHTML = ''; return; }
    const locked = !this.unlocked(id);
    const isEq = !!d.EQ[id];
    let body = '';
    if (isEq) {
      body = `<div class="lo-facts">
        ${fact('Zündzeit', secs(def.fuse, 1))}${fact('Radius', meters(def.radius, 1))}${fact('Max. Schaden', num(def.maxDamage))}
        ${fact('Vorkochen', def.cookable ? 'Ja' : 'Nein')}${fact('Haftend', def.sticky ? 'Ja' : 'Nein')}${fact('Anzahl', String(def.count || 1))}</div>`;
    } else {
      const cur = d.W[c[def.slot]];
      const st = def.stats || {};
      const cs = cur && cur.id !== def.id ? cur.stats || {} : null;
      const bars = STAT_LABELS.map(([k, l]) => {
        const v = st[k] || 0;
        const o = cs ? cs[k] || 0 : null;
        const delta = o == null ? '' : v > o ? `<em class="up">+${v - o}</em>` : v < o ? `<em class="dn">−${o - v}</em>` : '';
        return `<div class="lo-stat"><span>${l}</span><i><u style="width:${v}%"></u>${o != null ? `<s style="left:${Math.min(v, o)}%;width:${Math.abs(v - o)}%" class="${v >= o ? 'up' : 'dn'}"></s>` : ''}</i><b>${v}${delta}</b></div>`;
      }).join('');
      const ttk15 = typeof d.ttk === 'function' && def.cls !== 'melee' ? d.ttk(def, 15) : null;
      const eff = typeof d.effectiveRange === 'function' && def.cls !== 'melee' ? d.effectiveRange(def) : null;
      body = `
        <div class="lo-stats">${bars}</div>
        ${cs ? `<div class="lo-cmp">Vergleich mit <b>${esc(cur.name)}</b></div>` : ''}
        <div class="lo-facts">
          ${fact('Schaden', def.pellets > 1 ? `${def.pellets} × ${num(def.damage.max)}` : `${num(def.damage.max)}–${num(def.damage.min)}`)}
          ${fact('Kadenz', `${num(def.rpm)}/min`)}${fact('Magazin', `${def.mag} / ${def.reserve}`)}
          ${fact('Nachladen', secs(def.reloadTime, 1))}${fact('Anschlag', secs(def.adsTime, 2))}
          ${ttk15 != null && Number.isFinite(ttk15) ? fact('Zeit bis Abschuss (15 m)', secs(ttk15, 2)) : ''}
          ${eff != null && Number.isFinite(eff) ? fact('Wirksam bis', meters(eff)) : ''}
          ${fact('Visier', (d.SIGHTS[def.sight] && d.SIGHTS[def.sight].name) || '—')}${fact('Feuermodus', d.FIRE[def.fireMode] || def.fireMode)}
        </div>`;
    }
    const equipped = c[isEq ? 'lethal' : def.slot] === id;
    host.innerHTML = `
      <div class="lo-dhead"><small>${esc(isEq ? 'Granate' : (d.CLASSES[def.cls] || def.cls))}</small><h3>${esc(def.name)}<em>.</em></h3></div>
      <p class="lo-desc">${esc(def.description || '')}</p>
      ${locked ? `<div class="lo-locked">${ICON.lock}<span>Freischaltung ab <b>Stufe ${def.unlockLevel}</b>. Du bist Stufe ${this.level()}.</span></div>` : equipped ? `<div class="lo-on">${ICON.check}<span>Ausgerüstet</span></div>` : ''}
      ${body}`;
  }

  _choose(id) {
    const d = this._data();
    const c = this.cfg;
    const def = d.W[id] || d.EQ[id];
    if (!def) return;
    this.view = id;
    if (this.unlocked(id)) {
      const slot = d.EQ[id] ? 'lethal' : def.slot;
      if (slot === 'primary' || slot === 'secondary' || slot === 'lethal') c[slot] = id;
      this.menus.sound('confirm');
    } else this.menus.sound('error');
    this._renderLoadout();
    this._renderKit();
    this._showView();
  }

  _preset(pid) {
    const d = this._data();
    const l = d.LOADOUTS.find((x) => x.id === pid);
    if (!l) return;
    const c = this.cfg;
    for (const k of ['primary', 'secondary', 'lethal']) if (this.unlocked(l[k])) c[k] = l[k];
    this.view = c[this.slot];
    this._renderLoadout();
    this._renderKit();
    this._showView();
    this.menus.sound('confirm');
  }

  _renderKit() {
    const d = this._data();
    const c = this.cfg;
    const p = d.W[c.primary];
    const s = d.W[c.secondary];
    const g = d.EQ[c.lethal];
    const streaks = (d.MODES[c.modeId] || {}).streaks ? Object.values(d.STREAKS) : [];
    this.el.kit.innerHTML = `
      <div class="lb-kit-row"><small>Primär</small><span class="ico">${p && p.icon ? p.icon : ''}</span><b>${esc(p ? p.name : '—')}</b></div>
      <div class="lb-kit-row"><small>Sekundär</small><span class="ico">${s && s.icon ? s.icon : ''}</span><b>${esc(s ? s.name : '—')}</b></div>
      <div class="lb-kit-row"><small>Granate</small><span class="ico sm">${g && g.icon ? g.icon : ''}</span><b>${esc(g ? g.name : '—')}</b></div>
      ${streaks.length ? `<div class="lb-kit-streaks">${streaks.map((x) => `<span title="${esc(x.description)}"><i>${x.icon}</i>${x.kills}</span>`).join('')}</div>` : ''}`;
  }

  /** 3D-Vorschau auf eine Waffe setzen. */
  _showView(id) {
    const d = this._data();
    const wid = id || (this.tab === 'loadout' ? this.view || this.cfg[this.slot] : this.cfg.primary);
    const def = d.W[wid];
    const pv = this.menus.preview;
    if (this.el.stageName) this.el.stageName.innerHTML = def ? `<small>${esc(d.CLASSES[def.cls] || '')}</small><b>${esc(def.name)}</b>` : (d.EQ[wid] ? `<small>Granate</small><b>${esc(d.EQ[wid].name)}</b>` : '');
    if (pv && (def || d.EQ[wid])) pv.setWeapon(wid);
  }

  unmount() {
    this.el = null;
  }
}

function fact(label, value) {
  return `<div class="lo-fact"><small>${esc(label)}</small><b>${esc(value)}</b></div>`;
}

function clampInt(v, a, b) {
  const n = Math.round(Number(v));
  return Math.max(a, Math.min(b, Number.isFinite(n) ? n : a));
}
