// NULLPUNKT — Lobby: Einsatz (Modus-Karten, Kartenwahl mit Vorschau, Schwierigkeit, Teamgrößen mit Ausgleich)
// und Ausrüstung (Primär/Sekundär/Granate mit Werte-Balken aus computeStats, Vergleich, Stufen-Sperren,
// Vorlagen, 3D-Vorschau). Vorbelegung aus URL-Parametern (erster Aufruf) und den letzten Einstellungen.
// Reiter „Mehrspieler“: Inhalt und Logik in ui/net-menus.js (menus.net); der Fußknopf wird dort zu „Raum erstellen“.

import { rulesFor, limitsFor, teamWarning } from '../../shared/modes.data.js';
import { WEATHERS } from '../../shared/maps.data.js'; // atmosphere-weather
import { realTimePreset } from '../world/weather.js'; // Tageszeit „Echtzeit“ (Vorschau der aufgelösten Zeit)
import { CLASSES, SOLDIER_CLASS_ORDER, GAME_STYLES, STYLE_ORDER, resolveClassLoadout, classAllows, classProfile } from '../../shared/classes.data.js';
import { esc, num, secs, meters } from './dom.js';
import { ICON } from './icons.js';
import { drawMapArt } from './mapart.js';
import { camoRowHtml, equippedCamo } from './loadout-panel.js';
import { ProgressView } from './progress.js';

const DIFF_ORDER = ['rekrut', 'regulaer', 'veteran', 'elite'];
const STAT_LABELS = [['damage', 'Schaden'], ['fireRate', 'Kadenz'], ['range', 'Reichweite'], ['accuracy', 'Präzision'], ['mobility', 'Mobilität'], ['control', 'Kontrolle']];
const MAP_PREP = { hafen: 'im', altstadt: 'in der', werk: 'im', range: 'am', grenzland: 'im' };
const LENGTHS = [['kurz', 'Kurz'], ['standard', 'Standard'], ['lang', 'Lang']];

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
    this._offs = [];
    this.progress = new ProgressView(this.G);
  }

  /* ------------------------------------------------------------ Daten */

  _data() {
    const D = this.G.data || {};
    return {
      MODES: D.MODES || {}, ORDER: (D.MODE_ORDER || Object.keys(D.MODES || {})).filter((m) => (D.MODES || {})[m]),
      MAPS: D.MAPS || {}, MAP_ORDER: D.MAP_ORDER || Object.keys(D.MAPS || {}), W: D.WEAPONS || {}, EQ: D.EQUIPMENT || {},
      DIFF: D.DIFFICULTIES || {}, LOADOUTS: D.DEFAULT_LOADOUTS || [], CLASSES: D.WEAPON_CLASSES || {}, CLASS_ORDER: D.CLASS_ORDER || [],
      SIGHTS: D.SIGHTS || {}, FIRE: D.FIRE_MODES || {}, ttk: D.ttk, shotsToKill: D.shotsToKill, effectiveRange: D.effectiveRange, STREAKS: D.STREAKS || {},
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
      style: GAME_STYLES[S.get('gameStyle')] ? S.get('gameStyle') : 'arcade', cls: CLASSES[S.get('lastClass')] ? S.get('lastClass') : 'sturm',
      matchLength: 'standard',
      // atmosphere-weather: Wetter/Tageszeit wie die übrigen Lobby-Optionen gemerkt ('standard' = Kartenvorgabe)
      timeOfDay: S.get('lastTime') && S.get('lastTime') !== 'standard' ? S.get('lastTime') : null,
      weather: S.get('lastWeather') || 'standard',
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
      if (GAME_STYLES[prm.get('style')]) base.style = prm.get('style');
      if (CLASSES[prm.get('cls')]) base.cls = prm.get('cls');
      if (WEATHERS[prm.get('weather')] || prm.get('weather') === 'zufall') base.weather = prm.get('weather'); // atmosphere-weather
      if (prm.get('tod')) base.timeOfDay = prm.get('tod');
      else if (prm.get('weather')) this._wxAutoTime(base); // wie ein Start per URL: Morgennebel → Morgen
      // Zeit-/Punktelimit aus der URL sind Testparameter: nur mit debug=1 (Match dann ungewertet) und nur
      // für den Modus, mit dem die Seite geöffnet wurde
      const tl = G.debug ? parseFloat(prm.get('time')) : NaN;
      const sl = G.debug ? parseFloat(prm.get('score')) : NaN;
      if (Number.isFinite(tl) || Number.isFinite(sl)) base.limits = { modeId: base.modeId, timeLimit: Number.isFinite(tl) ? tl : null, scoreLimit: Number.isFinite(sl) ? sl : null };
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

  /** Teamgrenzen für Modus + Karte + Gerät (limitsFor, GROSSKAMPF §3.2). */
  _lim() {
    const d = this._data();
    const c = this.cfg;
    const G = this.G;
    return limitsFor(c.modeId, d.MAPS[c.mapId] || c.mapId, {
      tier: (G.renderer && G.renderer.quality) || 'high', touch: !!(G.input && G.input.mode === 'touch'), deviceMemory: navigator.deviceMemory ?? null,
    });
  }

  _fixMode() {
    const d = this._data();
    const c = this.cfg;
    const m = d.MODES[c.modeId] || {};
    const maps = this.mapsFor(c.modeId);
    if (!maps.includes(c.mapId)) c.mapId = (m.recommendedMaps || []).find((x) => maps.includes(x)) || maps[0] || c.mapId;
    const L = this._lim();
    const lim = { allies: L.allies, enemies: L.enemies };
    const teams = m.teams !== false;
    // Neuer Modus/Kartenmaßstab: Empfehlung für dieses Gerät übernehmen
    const key = `${c.modeId}:${L.scale}`;
    if (this._limKey && this._limKey !== key) { c.enemies = null; c.allies = null; c.balance = true; }
    this._limKey = key;
    if (!Number.isFinite(c.enemies) || c.enemies == null) c.enemies = L.recommended.enemies ?? m.defaultEnemies ?? (teams ? 6 : 7);
    c.enemies = clampInt(c.enemies, lim.enemies[0], lim.enemies[1]);
    if (!teams) c.allies = 0;
    else {
      if (c.modeId === 'inf') { if (!Number.isFinite(c.allies) || c.allies == null) c.allies = L.recommended.allies ?? 10; } else if (c.balance || !Number.isFinite(c.allies) || c.allies == null) c.allies = c.balance ? c.enemies - 1 : m.defaultAllies ?? 5;
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

  /** Tageszeit der gewählten Karte (null = Kartenzeit; gemerkte Zeit, die die Karte nicht hat → null). atmosphere-weather
   *  'zufall' und 'echtzeit' bleiben stehen – aufgelöst wird beim Start (world/weather.js resolveConditions). */
  _todFor(c) {
    const t = c.timeOfDay;
    if (!t || t === 'zufall' || t === 'echtzeit') return t || null;
    const map = this._data().MAPS[c.mapId] || {};
    return (Array.isArray(map.times) ? map.times : []).some((x) => x.id === t) ? t : null;
  }

  /**
   * atmosphere-weather: Wetter mit eigener Tageszeit (Morgennebel → Morgen) bei „Standard“-Zeit sichtbar vorwählen –
   * die Lobby zeigt so genau, was gespielt wird; „Standard“ (Kartenzeit) bleibt danach ausdrücklich wählbar.
   */
  _wxAutoTime(c) {
    const auto = WEATHERS[c.weather]?.time;
    const map = this._data().MAPS[c.mapId] || {};
    if (!auto || this._todFor(c) || map.weatherDefault === c.weather || !(Array.isArray(map.times) ? map.times : []).some((x) => x.id === auto)) return;
    c.timeOfDay = auto;
    try { this.G.settings.set('lastTime', auto); } catch { /* */ }
  }

  /** Startkonfiguration für main (onStart). */
  config() {
    const c = this.cfg;
    const camo = {};
    for (const k of ['primary', 'secondary']) { const v = equippedCamo(this.G, c[k]); if (v) camo[c[k]] = v; }
    let skin = null;
    try { skin = this.G.profile.get().cosmetics.equipped.operator[c.cls] || null; } catch { /* */ }
    return {
      modeId: c.modeId, mapId: c.mapId, difficulty: c.difficulty, allies: c.allies, enemies: c.enemies,
      style: c.style, crosshair: c.style === 'realistisch' ? !!this.G.settings.get('realisticCrosshair') : null,
      matchLength: c.matchLength, timeOfDay: this._todFor(c) || 'standard', weather: c.weather && c.weather !== 'standard' ? c.weather : null,
      loadout: { primary: c.primary, secondary: c.secondary, lethal: c.lethal, cls: c.cls, camo, ...(skin ? { skin } : {}) },
      ...(c.limits && c.limits.modeId === c.modeId ? { timeLimit: c.limits.timeLimit, scoreLimit: c.limits.scoreLimit } : {}),
    };
  }

  /* ------------------------------------------------------------ Aufbau */

  mount(screen) {
    this._initCfg();
    const G = this.G;
    screen.innerHTML = `
      <div class="lb">
        <header class="lb-head">
          <div class="lb-brand">NULL<em>PUNKT</em><i>.</i></div>
          <div class="lb-tabs m-tabs" role="tablist">
            <button type="button" class="m-tab" role="tab" data-tab="deploy" aria-selected="${this.tab === 'deploy'}">${ICON.map}<span>Einsatz</span></button>
            <button type="button" class="m-tab" role="tab" data-tab="loadout" aria-selected="${this.tab === 'loadout'}">${ICON.target}<span>Ausrüstung</span></button>
            <button type="button" class="m-tab" role="tab" data-tab="progress" aria-selected="${this.tab === 'progress'}">${ICON.trophy}<span>Fortschritt</span></button>
            <button type="button" class="m-tab" role="tab" data-tab="online" aria-selected="${this.tab === 'online'}">${ICON.globe}<span>Mehrspieler</span><i class="m-tab-beta" title="Erste Fassung – Fehler gerne melden">Beta</i></button>
          </div>
          <div class="lb-me"><button type="button" class="lb-profile" data-act="profile" title="Rufzeichen ändern"></button></div>
          <div class="lb-tools">
            <button type="button" class="m-icon" data-act="settings" aria-label="Einstellungen" title="Einstellungen">${ICON.gear}</button>
            <button type="button" class="m-icon" data-act="controls" aria-label="Steuerung" title="Steuerung">${ICON.pad}</button>
            <button type="button" class="m-icon" data-act="exit" aria-label="Zur Website" title="Zur Website">${ICON.exit}</button>
          </div>
        </header>
        <div class="lb-main">
          <div class="lb-pane m-scroll" data-scrollable data-pane="deploy"${this.tab === 'deploy' ? '' : ' hidden'}></div>
          <div class="lb-pane lb-pane-loadout" data-pane="loadout"${this.tab === 'loadout' ? '' : ' hidden'}></div>
          <div class="lb-pane m-scroll" data-scrollable data-pane="progress"${this.tab === 'progress' ? '' : ' hidden'}></div>
          <div class="lb-pane m-scroll" data-scrollable data-pane="online"${this.tab === 'online' ? '' : ' hidden'}></div>
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
      screen, deploy: screen.querySelector('[data-pane="deploy"]'), loadout: screen.querySelector('[data-pane="loadout"]'), progress: screen.querySelector('[data-pane="progress"]'), online: screen.querySelector('[data-pane="online"]'),
      start: screen.querySelector('.lb-start'),
      stage: screen.querySelector('.lb-stage'), stageName: screen.querySelector('.lb-stage-name'), kit: screen.querySelector('.lb-kit'),
      summary: screen.querySelector('.lb-summary'), side: screen.querySelector('.lb-side'), profile: screen.querySelector('.lb-profile'),
    };
    screen.addEventListener('click', (e) => this._click(e));
    this._renderProfile();
    // Rufzeichen/Stufe live (Einstellungen hier, auf der Website oder in einem anderen Tab)
    this._offs.push(
      G.settings.onChange((key) => { if (key === 'playerName') this._renderProfile(); }),
      G.profile.onChange(() => this._renderProfile()),
    );
    this._renderDeploy();
    this._renderLoadout();
    this._renderKit();
    this._renderSummary();
    this._syncTab();
  }

  _renderProfile() {
    if (!this.el || !this.el.profile) return;
    const P = this.G.profile;
    const prof = P.get();
    const rank = P.rankFor ? P.rankFor(prof.level) : { name: '' };
    const prog = P.levelProgress ? P.levelProgress(prof.xp) : { progress: 0 };
    const b = this.el.profile;
    b.setAttribute('aria-label', `Profil: ${prof.name}, Stufe ${prof.level}. Rufzeichen ändern`);
    b.innerHTML = `<span class="lb-rank">${P.rankIcon ? P.rankIcon(prof.level, { size: 30 }) : ''}</span>
      <span class="lb-pinfo"><b>${esc(prof.name)}</b><small>Stufe ${prof.level} · ${esc(rank.name)}</small><i class="lb-xp"><u style="transform:scaleX(${(prog.progress || 0).toFixed(3)})"></u></i></span>`;
  }

  _click(e) {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const c = this.cfg;
    const ds = b.dataset;
    if (ds.tab) { this.tab = ds.tab; this._syncTab(); return; }
    if (ds.mode) { c.modeId = ds.mode; this._fixMode(); this._renderDeploy(); this._renderSummary(); this._renderKit(); this.menus.sound('click'); return; }
    if (ds.map) { c.mapId = ds.map; this._fixMode(); this._renderDeploy(); this._renderSummary(); this.menus.sound('click'); return; }
    if (ds.style) {
      c.style = GAME_STYLES[ds.style] ? ds.style : 'arcade';
      try { this.G.settings.set('gameStyle', c.style); } catch { /* */ }
      this._renderDeploy(); this._renderSummary(); this.menus.sound('click'); return;
    }
    if (ds.xhair != null) { try { this.G.settings.set('realisticCrosshair', !this.G.settings.get('realisticCrosshair')); } catch { /* */ } this._renderDeploy(); this.menus.sound('toggle'); return; }
    if (ds.len) { c.matchLength = ds.len; this._renderDeploy(); this.menus.sound('click'); return; }
    if (ds.tod != null) { c.timeOfDay = ds.tod || null; try { this.G.settings.set('lastTime', ds.tod || 'standard'); } catch { /* */ } this._renderDeploy(); this.menus.sound('click'); return; }
    if (ds.wx != null) { c.weather = ds.wx || 'standard'; this._wxAutoTime(c); try { this.G.settings.set('lastWeather', c.weather); } catch { /* */ } this._renderDeploy(); this.menus.sound('click'); return; }
    if (ds.cls) { this._setClass(ds.cls); return; }
    if (ds.camo) { this._setCamo(ds.camo, b); return; }
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
    this.el.progress.hidden = this.tab !== 'progress';
    this.el.online.hidden = this.tab !== 'online';
    if (this.tab === 'progress') this.progress.mount(this.el.progress); else this.progress.unmount();
    // Mehrspieler (ui/net-menus.js): Reiter nur beobachten (öffentliche Spiele), solange er sichtbar ist
    const nm = this.menus.net;
    if (nm) { if (this.tab === 'online') nm.mountPane(this.el.online); else nm.unmountPane(); }
    this._renderStart();
    this._renderSummary();
    s.querySelector('.lb').dataset.tab = this.tab;
    if (this.tab === 'loadout') { this.view = this.view || this.cfg[this.slot]; this._showView(); }
    else this._showView(this.cfg.primary);
    requestAnimationFrame(() => this._drawMaps());
  }

  _step(which, d) {
    const c = this.cfg;
    const m = this._data().MODES[c.modeId] || {};
    const L = this._lim();
    const lim = { allies: L.allies, enemies: L.enemies };
    if (which === 'enemies') {
      c.enemies = clampInt(c.enemies + d, lim.enemies[0], lim.enemies[1]);
      if (c.balance && m.teams !== false && c.modeId !== 'inf') c.allies = clampInt(c.enemies - 1, lim.allies[0], lim.allies[1]);
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
        <span class="lb-map-txt"><b>${esc(x.name)}</b><small>${x.scale === 'gross' ? 'Großkarte · ' : ''}${esc(x.timeOfDay || x.subtitle || '')}</small></span></button>`;
    }).join('');
    const diffs = DIFF_ORDER.filter((id) => d.DIFF[id] || true).map((id) => `<button type="button" role="radio" data-diff="${id}" aria-checked="${id === c.difficulty}">${esc((d.DIFF[id] && d.DIFF[id].name) || id)}</button>`).join('');
    const xpm = diff.xpMult && diff.xpMult !== 1 ? `EP ×${num(diff.xpMult, 2).replace(/,?0+$/, '')}` : 'EP ×1';
    const st = GAME_STYLES[c.style] || GAME_STYLES.arcade;
    const styles = STYLE_ORDER.map((id) => `<button type="button" role="radio" data-style="${id}" aria-checked="${id === c.style}">${esc(GAME_STYLES[id].label)}</button>`).join('');
    const xh = !!this.G.settings.get('realisticCrosshair');
    const map = d.MAPS[c.mapId] || {};
    const times = Array.isArray(map.times) ? map.times : [];
    // atmosphere-weather: Wetter je Karte (MAPS[id].weathers), Standard = Kartenwetter, Zufall
    const wxs = (Array.isArray(map.weathers) ? map.weathers : []).filter((w) => WEATHERS[w]);
    const wxSel = c.weather === 'zufall' || wxs.includes(c.weather) ? c.weather : 'standard';
    const todSel = this._todFor(c);
    // Echtzeit: Vorschau, welche Tageszeit der Karte jetzt gespielt würde (aufgelöst wird beim Start erneut)
    let rtNote = '';
    if (todSel === 'echtzeit') {
      const rt = realTimePreset(map);
      const rtName = rt ? (times.find((t) => t.id === rt) || {}).name || rt : map.timeOfDay || 'Kartenzeit';
      rtNote = `<p class="lb-note">Passend zur echten Uhrzeit – jetzt: <b>${esc(rtName)}</b></p>`;
    }
    const extra = `${m.matchLengths ? `<div><h2 class="m-h2">Matchlänge</h2><div class="m-seg" role="radiogroup" aria-label="Matchlänge">${LENGTHS.map(([id, l]) => `<button type="button" role="radio" data-len="${id}" aria-checked="${id === c.matchLength}">${l}</button>`).join('')}</div></div>` : ''}
      ${times.length ? `<div><h2 class="m-h2">Tageszeit</h2><div class="m-seg" role="radiogroup" aria-label="Tageszeit"><button type="button" role="radio" data-tod="" aria-checked="${!todSel}">${esc(map.timeOfDay || 'Standard')}</button>${times.map((t) => `<button type="button" role="radio" data-tod="${esc(t.id)}" aria-checked="${t.id === todSel}">${esc(t.name || t.label || t.id)}</button>`).join('')}<button type="button" role="radio" data-tod="echtzeit" aria-checked="${todSel === 'echtzeit'}" title="Passend zur echten Uhrzeit">Echtzeit</button><button type="button" role="radio" data-tod="zufall" aria-checked="${todSel === 'zufall'}">Zufall</button></div>${rtNote}</div>` : ''}
      ${wxs.length ? `<div><h2 class="m-h2">Wetter</h2><div class="m-seg" role="radiogroup" aria-label="Wetter">${[['standard', 'Standard', map.weather || ''], ...wxs.map((w) => [w, WEATHERS[w].name, WEATHERS[w].short || '']), ['zufall', 'Zufall', 'Zufälliges Wetter beim Start']].map(([id, l, t]) => `<button type="button" role="radio" data-wx="${id}" aria-checked="${id === wxSel}"${t ? ` title="${esc(t)}"` : ''}>${esc(l)}</button>`).join('')}</div></div>` : ''}`;
    this.el.deploy.innerHTML = `
      <section class="lb-sec"><h2 class="m-h2">Modus</h2><div class="lb-modes" role="group" aria-label="Modus">${modes}</div>
        <div class="lb-modeinfo"><p>${esc(m.description || '')}</p><ul class="lb-rules"></ul></div></section>
      <section class="lb-sec"><h2 class="m-h2">Karte</h2><div class="lb-maps" role="group" aria-label="Karte">${mapCards}</div></section>
      <section class="lb-sec lb-row2">
        <div><h2 class="m-h2">Gegnerstärke</h2><div class="m-seg lb-diff" role="radiogroup" aria-label="Gegnerstärke">${diffs}</div>
          <p class="lb-note">${esc(diff.description || '')} <b>${xpm}</b></p></div>
        <div class="lb-teams"></div>
      </section>
      ${c.modeId === 'training' ? '' : `<section class="lb-sec lb-row2">
        <div><h2 class="m-h2">Spielstil</h2><div class="m-seg lb-style" role="radiogroup" aria-label="Spielstil">${styles}</div>
          <p class="lb-note">${esc(st.desc || '')}</p>
          ${c.style === 'realistisch' ? `<button type="button" class="lb-bal" data-xhair aria-pressed="${xh}"><i class="m-check">${ICON.check}</i>Fadenkreuz anzeigen</button>` : ''}</div>
        ${extra.trim() ? `<div class="lb-extra">${extra}</div>` : ''}
      </section>`}`;
    this._renderTeams();
    requestAnimationFrame(() => this._drawMaps());
  }

  /** Regeln des Modus; die Besetzungszeile folgt den gewählten Teamgrößen. */
  _renderRules() {
    const ul = this.el.deploy.querySelector('.lb-rules');
    if (!ul) return;
    const c = this.cfg;
    const rules = rulesFor(c.modeId, c).slice(0, 5);
    ul.hidden = !rules.length;
    ul.innerHTML = rules.map((r) => `<li>${esc(r)}</li>`).join('');
  }

  _renderTeams() {
    const d = this._data();
    const c = this.cfg;
    const m = d.MODES[c.modeId] || {};
    const host = this.el.deploy.querySelector('.lb-teams');
    if (!host) return;
    this._renderRules();
    const teams = m.teams !== false;
    const L = this._lim();
    const lim = { allies: L.allies, enemies: L.enemies };
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
      ${teams && c.modeId !== 'inf' ? `<button type="button" class="lb-bal" data-balance aria-pressed="${!!c.balance}"><i class="m-check">${ICON.check}</i>Teams ausgleichen</button>` : ''}
      <p class="lb-note">${c.modeId === 'inf' ? `${c.allies + 1} Überlebende gegen ${c.enemies} Infizierte${c.enemies === 1 ? 'n' : ''}.` : teams ? `${c.allies + 1} gegen ${c.enemies}${c.allies + 1 !== c.enemies ? ' – das kleinere Team kommt schneller zurück.' : '.'}` : `${c.enemies + 1} Spieler, jeder für sich.`}</p>
      ${(() => { const w = teamWarning(L, c.allies, c.enemies, teams && c.modeId !== 'inf'); return w.level ? `<p class="lb-warn is-${w.level}">${ICON.warn}<span>${esc(w.text)}</span></p>` : ''; })()}`;
  }

  _drawMaps() {
    const d = this._data();
    if (!this.el || !this.el.deploy) return;
    this.el.deploy.querySelectorAll('canvas[data-art]').forEach((cv) => {
      if (cv.offsetParent) drawMapArt(cv, d.MAPS[cv.dataset.art]);
    });
  }

  /** Fußknopf: „Einsatz starten“ – im Mehrspieler-Reiter „Raum erstellen“ (menus.js: data-act net-host). */
  _renderStart() {
    const b = this.el && this.el.start;
    if (!b) return;
    const online = this.tab === 'online';
    const act = online ? 'net-host' : 'start';
    b.disabled = online && !(this.menus.net && this.menus.net.net);
    if (b.dataset.act === act) return;
    b.dataset.act = act;
    b.classList.remove('is-go');
    b.innerHTML = online ? `${ICON.userPlus}<span>Raum erstellen<em>.</em></span>` : `${ICON.play}<span>Einsatz starten<em>.</em></span>`;
  }

  _renderSummary() {
    if (this.tab === 'online' && this.menus.net) { this.el.summary.innerHTML = this.menus.net.summaryHtml(); return; }
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
    const sty = c.style === 'realistisch' && c.modeId !== 'training' ? ' · Realistisch' : '';
    const cl = CLASSES[c.cls] ? ` · ${CLASSES[c.cls].name}` : '';
    this.el.summary.innerHTML = `<small>${esc(m.short || '')} · ${esc(prep)} ${esc(map.name || c.mapId)}</small><b>${esc(m.name || c.modeId)}</b><span>${esc(who)}${c.modeId === 'training' ? '' : ` · ${esc(diff.name || c.difficulty)}${esc(sty)}`}${esc(cl)}</span>`;
  }

  /* ------------------------------------------------------------ Ausrüstung */

  _renderLoadout() {
    const d = this._data();
    const c = this.cfg;
    const lvl = this.level();
    const slots = [['primary', 'Primär', d.W[c.primary]], ['secondary', 'Sekundär', d.W[c.secondary]], ['lethal', 'Granate', d.EQ[c.lethal]]];
    let list = '';
    if (this.slot === 'lethal') {
      list = Object.values(d.EQ).filter((x) => !x.kind || x.kind === 'lethal').map((x) => this._item(x, x.id === c.lethal, lvl, 'Ausrüstung')).join('');
    } else {
      const ws = Object.values(d.W).filter((w) => w.slot === this.slot);
      const order = d.CLASS_ORDER.length ? d.CLASS_ORDER : [...new Set(ws.map((w) => w.cls))];
      for (const cls of order) {
        const g = ws.filter((w) => w.cls === cls);
        if (!g.length) continue;
        list += `<div class="lo-cls">${esc(d.CLASSES[cls] || cls)}</div>${g.map((w) => this._item(w, w.id === c[this.slot], lvl, classAllows(c.cls, w.cls) ? d.CLASSES[w.cls] : null)).join('')}`;
      }
    }
    const presets = d.LOADOUTS.map((l) => {
      const locked = (l.unlockLevel || 1) > lvl;
      const active = l.primary === c.primary && l.secondary === c.secondary && l.lethal === c.lethal;
      return `<button type="button" class="lo-preset" data-preset="${esc(l.id)}" aria-pressed="${active}"${locked ? ' disabled' : ''} title="${esc(l.description || '')}">${locked ? ICON.lock : ''}${esc(l.name)}${locked ? `<small>Stufe ${l.unlockLevel}</small>` : ''}</button>`;
    }).join('');
    const prof = classProfile(c.cls);
    const classes = SOLDIER_CLASS_ORDER.map((id) => {
      const k = CLASSES[id];
      const pr = classProfile(id);
      return `<button type="button" class="lo-clsbtn" data-cls="${id}" aria-pressed="${id === c.cls}" title="${esc(k.role)}"><i>${ICON[id] || ICON.user}</i><b>${esc(k.name)}</b>
        <span class="lo-bars"><u style="--v:${pr.tempo}" title="Tempo"></u><u style="--v:${pr.schutz}" title="Schutz"></u><u style="--v:${pr.reichweite}" title="Reichweite"></u></span></button>`;
    }).join('');
    this.el.loadout.innerHTML = `
      <div class="lo">
        <div class="lo-classes" role="group" aria-label="Klasse">${classes}</div>
        <p class="lo-role">${esc(CLASSES[c.cls].role)} <span>${ICON.plate}${esc(prof.armorLabel || '')} · ${prof.plates || 0} Platten · Helm ${esc(prof.helmetLabel || '')}</span></p>
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
    if (!locked && cls === null) {
      const k = CLASSES[this.cfg.cls];
      return `<button type="button" class="lo-item is-locked" data-weapon="${esc(def.id)}" role="option" aria-selected="false" aria-disabled="true">
      <span class="lo-ico">${def.icon || ''}</span><span class="lo-name"><b>${esc(def.name)}</b><small>Nicht für ${esc(k ? k.name : '')}</small></span></button>`;
    }
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
      const stk15 = typeof d.shotsToKill === 'function' && def.cls !== 'melee' ? d.shotsToKill(def, 15) : null;
      const eff = typeof d.effectiveRange === 'function' && def.cls !== 'melee' ? d.effectiveRange(def) : null;
      body = `
        <div class="lo-stats">${bars}</div>
        ${cs ? `<div class="lo-cmp">Vergleich mit <b>${esc(cur.name)}</b></div>` : ''}
        <div class="lo-facts">
          ${fact('Schaden', def.pellets > 1 ? `${def.pellets} × ${num(def.damage.max)}` : `${num(def.damage.max)}–${num(def.damage.min)}`)}
          ${fact('Kadenz', `${num(def.rpm)}/min`)}${fact('Magazin', `${def.mag} / ${def.reserve}`)}
          ${fact('Nachladen', secs(def.reloadTime, 1))}${fact('Anschlag', secs(def.adsTime, 2))}
          ${stk15 != null && Number.isFinite(stk15) ? fact('Treffer bis Abschuss', `${stk15} auf 15 m`) : ''}
          ${ttk15 != null && Number.isFinite(ttk15) && ttk15 > 0 ? fact('Zeit bis Abschuss', `${num(Math.round(ttk15))} ms auf 15 m`) : ''}
          ${eff != null && Number.isFinite(eff) ? fact('Wirksam bis', meters(eff)) : ''}
          ${fact('Visier', (d.SIGHTS[def.sight] && d.SIGHTS[def.sight].name) || '—')}${fact('Feuermodus', d.FIRE[def.fireMode] || def.fireMode)}
        </div>`;
    }
    const equipped = c[isEq ? 'lethal' : def.slot] === id;
    host.innerHTML = `
      <div class="lo-dhead"><small>${esc(isEq ? 'Granate' : (d.CLASSES[def.cls] || def.cls))}</small><h3>${esc(def.name)}<em>.</em></h3></div>
      <p class="lo-desc">${esc(def.description || '')}</p>
      ${locked ? `<div class="lo-locked">${ICON.lock}<span>Freischaltung ab <b>Stufe ${def.unlockLevel}</b>. Du bist Stufe ${this.level()}.</span></div>` : equipped ? `<div class="lo-on">${ICON.check}<span>Ausgerüstet</span></div>` : ''}
      ${body}
      ${!isEq && !locked ? camoRowHtml(this.G, id, equippedCamo(this.G, id)) : ''}`;
  }

  _choose(id) {
    const d = this._data();
    const c = this.cfg;
    const def = d.W[id] || d.EQ[id];
    if (!def) return;
    this.view = id;
    if (d.W[id] && !classAllows(c.cls, d.W[id].cls)) { this.menus.sound('error'); this._renderLoadout(); this._showView(); return; }
    if (this.unlocked(id)) {
      const slot = d.EQ[id] ? 'lethal' : def.slot;
      if (slot === 'primary' || slot === 'secondary' || slot === 'lethal') c[slot] = id;
      this.menus.sound('confirm');
    } else this.menus.sound('error');
    this._renderLoadout();
    this._renderKit();
    this._showView();
  }

  /** Klasse wählen: gespeicherte Klassenausrüstung bzw. Standard der Klasse (classes.data.js). */
  _setClass(id) {
    const d = this._data();
    const c = this.cfg;
    if (!CLASSES[id]) return;
    const saved = (this.G.settings.get('classLoadouts') || {})[id] || null;
    const r = resolveClassLoadout(id, { weapons: d.W, equipment: d.EQ, isUnlocked: (x) => this.unlocked(x), base: saved });
    c.cls = id;
    for (const k of ['primary', 'secondary', 'lethal']) if (r[k] && this.unlocked(r[k])) c[k] = r[k];
    try { this.G.settings.set('lastClass', id); } catch { /* */ }
    this.view = c[this.slot];
    this._renderLoadout();
    this._renderKit();
    this._renderSummary();
    this._showView();
    this.menus.sound('confirm');
  }

  /** Tarnung der angezeigten Waffe ausrüsten (Profil-Kosmetik). */
  _setCamo(camoId, btn) {
    const D = this.G.data || {};
    const wid = this.view || this.cfg[this.slot];
    if (btn && btn.getAttribute('aria-disabled') === 'true') { this.menus.sound('error'); return; }
    const cm = D.CAMOS && D.CAMOS[camoId];
    try { this.G.profile.equipCosmetic('weapon', wid, cm && cm.unlock && cm.unlock.type === 'default' ? null : camoId); } catch { /* */ }
    this.menus.sound('confirm');
    this._renderDetail();
    const pv = this.menus.preview;
    if (pv && typeof pv.setCamo === 'function') pv.setCamo(camoId);
  }

  /** Klassenausrüstung beim Start merken (settings.classLoadouts, core-mechanics). */
  saveClassLoadout() {
    const c = this.cfg;
    try {
      const all = { ...(this.G.settings.get('classLoadouts') || {}) };
      all[c.cls] = { primary: c.primary, secondary: c.secondary, lethal: c.lethal, cls: c.cls };
      this.G.settings.set('classLoadouts', all);
    } catch { /* */ }
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
    this.progress.unmount();
    if (this.menus.net) this.menus.net.unmountPane();
    for (const off of this._offs) off();
    this._offs = [];
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
