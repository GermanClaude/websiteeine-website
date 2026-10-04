// NULLPUNKT — HUD (§9) in #hud, COD-Mobile-artig, ruhig und gut lesbar (Rajdhani NP für Zahlen/Labels).
// Bestandteile: dynamisches Fadenkreuz, Treffermarker (Kopf/Abschuss), Trefferrichtung, Rotrand bei wenig
// Leben, Munition/Waffe/Granaten, Lebensbalken, Teamstand + Zeit + Modusleiste (TDM/DOM/FFA/Gun/Schießstand),
// Kompass, Minikarte, Abschussmeldungen, Punkte-Einblendungen + Medaillen, Serienprämien, Nachlade-/Munitions-
// hinweise, Granaten-Kochzeit, Zielfernrohr (Sniper) + ACOG-Tunnel, Flaggenmarker in der Welt, Einnahmebalken,
// Punktetabelle (Tab/Touch), Start-Countdown-Banner, Todes-/Wiedereinstiegsbanner, Hinweise (Serien, Flaggen,
// Verlängerung, Führung), Schießstand-Panel (Statistik, Parcours) und die Zielkarte des Präzisionsschlags.
// Interaktive Teile liegen in #hud-top (über der Touch-Steuerung, unter den Menüs).

import * as THREE from 'three';
import { el, esc, num, pct, clock, secs, meters, setText, setHtml, toggle, setStyle, clamp, weaponName } from './dom.js';
import { ICON, medalBadge } from './icons.js';
import { Minimap } from './minimap.js';
import { Killfeed } from './killfeed.js';
import { scoreboardHtml, liveRows } from './scoreboard.js';
import { StrikeTargeting } from './strike-target.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const COMPASS = [[0, 'N'], [45, 'NO'], [90, 'O'], [135, 'SO'], [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']];
const DEG_PX = 2.4;
const PAD_HINT = { reload: 'X', swap: 'Y', grenade: 'LB', melee: 'RB', interact: 'X', streak1: '▲', streak2: '◀', streak3: '▶', scoreboard: 'View' };
const KEY_HINT = { reload: 'R', swap: '1/2', grenade: 'G', melee: 'V', interact: 'F', streak1: '3', streak2: '4', streak3: '5', scoreboard: 'Tab' };
const NOTICE_LIFE = 2.6;

export class HUD {
  constructor(G) {
    this.G = G;
    this.root = null;
    this.top = null;
    this._subs = null;
    this._visible = false;
    this.feed = null;
    this.minimap = null;
    this.targeting = null;
    this._dmgPool = [];
    this.reset();
  }

  reset() {
    this._hitT = 0;
    this._hitKind = '';
    this._dirs = [];
    this._popups = { total: 0, lines: [], t: 0 };
    this._medals = [];
    this._medalT = 0;
    this._notices = [];
    this._death = null;
    this._countT = 0;
    this._bannerT = 0;
    this._slowT = 0;
    this._boardT = 0;
    this._lastLead = null;
    this._lastMinuteSaid = false;
    this._cook = null;
    this._post = { desat: 0 };
    this._dmgIdx = 0;
    this._parcours = null;
    this._fov = 0;
  }

  /* ================================================================ Aufbau */

  _build() {
    if (this.root) return;
    const host = document.getElementById('hud') || document.body;
    const r = el('div', 'h-root');
    r.hidden = true;
    r.innerHTML = `
      <div class="h-lowhp"></div>
      <div class="h-flash"></div>
      <div class="h-acog"></div>
      <div class="h-scope"><div class="h-scope-lens"></div>
        <svg class="h-scope-ret" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <path d="M-100 0H-6M6 0H100M0 -100V-6M0 6V100" />
          <path class="thin" d="M-60 -3V3M-40 -3V3M-20 -3V3M20 -3V3M40 -3V3M60 -3V3M-3 20H3M-3 40H3M-3 60H3" />
          <circle r="1.1" />
        </svg>
      </div>
      <div class="h-markers"></div>
      <div class="h-dmgnums"></div>
      <div class="h-hitdirs">${'<div class="h-hitdir"><i></i></div>'.repeat(6)}</div>
      <div class="h-cross" data-style="cross"><i class="l"></i><i class="r"></i><i class="t"></i><i class="b"></i><i class="c"></i><i class="o"></i></div>
      <div class="h-hit"><i></i><i></i><i></i><i></i></div>
      <div class="h-killico"></div>
      <div class="h-cook"><svg viewBox="0 0 44 44"><circle class="bg" cx="22" cy="22" r="19"/><circle class="fg" cx="22" cy="22" r="19"/></svg><b></b></div>
      <div class="h-ammo-hint"><span class="t"></span><kbd></kbd><i class="bar"></i></div>
      <div class="h-tl"><div class="h-mm"></div><div class="h-uav" hidden>${ICON.radar}<span></span></div></div>
      <div class="h-feed" aria-live="off"></div>
      <div class="h-top">
        <div class="h-mtag"></div>
        <div class="h-scores">
          <div class="h-s h-s-a"><b>0</b><i><u></u></i><small></small></div>
          <div class="h-time"><span>0:00</span><small></small></div>
          <div class="h-s h-s-b"><b>0</b><i><u></u></i><small></small></div>
        </div>
        <div class="h-sub"></div>
        <div class="h-compass"><div class="h-compass-strip"></div><i class="h-compass-needle"></i><span class="h-compass-deg"></span></div>
      </div>
      <div class="h-notices"></div>
      <div class="h-center"><div class="h-banner"><div class="k"></div><div class="t"></div><div class="s"></div></div><div class="h-count"></div></div>
      <div class="h-capture" hidden><div class="h-capture-l"><b></b><span></span></div><i><u></u></i></div>
      <div class="h-popups"><div class="h-pop"><b></b><div class="lines"></div></div></div>
      <div class="h-medal"></div>
      <div class="h-death" hidden><div class="k">Ausgeschaltet<em>.</em></div><div class="by"></div><div class="info"></div><div class="re"><span></span><i><u></u></i></div></div>
      <div class="h-health"><b>100</b><i><u></u><s></s></i></div>
      <div class="h-weapon"><div class="h-wname"><span class="n"></span><span class="m"></span></div><div class="h-ammo"><b>0</b><span>/ 0</span></div><div class="h-equip"></div><div class="h-next"></div></div>
      <div class="h-streaks"></div>
      <div class="h-train" hidden></div>
      <div class="h-board" hidden data-scrollable></div>`;
    host.appendChild(r);
    const q = (s) => r.querySelector(s);
    this.el = {
      lowhp: q('.h-lowhp'), flash: q('.h-flash'), acog: q('.h-acog'), scope: q('.h-scope'), markers: q('.h-markers'), dmgnums: q('.h-dmgnums'),
      dirs: [...r.querySelectorAll('.h-hitdir')], cross: q('.h-cross'), hit: q('.h-hit'), killico: q('.h-killico'), cook: q('.h-cook'), cookFg: q('.h-cook .fg'), cookT: q('.h-cook b'),
      ammoHint: q('.h-ammo-hint'), ammoHintT: q('.h-ammo-hint .t'), ammoHintK: q('.h-ammo-hint kbd'), ammoHintBar: q('.h-ammo-hint .bar'),
      mm: q('.h-mm'), uav: q('.h-uav'), uavT: q('.h-uav span'), feed: q('.h-feed'), top: q('.h-top'), mtag: q('.h-mtag'),
      sA: q('.h-s-a'), sAv: q('.h-s-a b'), sAbar: q('.h-s-a u'), sAs: q('.h-s-a small'), sB: q('.h-s-b'), sBv: q('.h-s-b b'), sBbar: q('.h-s-b u'), sBs: q('.h-s-b small'),
      time: q('.h-time'), timeT: q('.h-time span'), timeS: q('.h-time small'), sub: q('.h-sub'),
      compass: q('.h-compass'), strip: q('.h-compass-strip'), deg: q('.h-compass-deg'),
      notices: q('.h-notices'), banner: q('.h-banner'), bannerK: q('.h-banner .k'), bannerT: q('.h-banner .t'), bannerS: q('.h-banner .s'), count: q('.h-count'),
      capture: q('.h-capture'), captureB: q('.h-capture b'), captureS: q('.h-capture-l span'), captureBar: q('.h-capture u'),
      pop: q('.h-pop'), popTotal: q('.h-pop b'), popLines: q('.h-pop .lines'), medal: q('.h-medal'),
      death: q('.h-death'), deathBy: q('.h-death .by'), deathInfo: q('.h-death .info'), deathRe: q('.h-death .re span'), deathBar: q('.h-death .re u'),
      health: q('.h-health'), hpN: q('.h-health b'), hpBar: q('.h-health u'), hpLag: q('.h-health s'),
      weapon: q('.h-weapon'), wName: q('.h-wname .n'), wMode: q('.h-wname .m'), mag: q('.h-ammo b'), reserve: q('.h-ammo span'), equip: q('.h-equip'), next: q('.h-next'),
      streaks: q('.h-streaks'), train: q('.h-train'), board: q('.h-board'),
    };
    // Kompass-Streifen (zweimal 360° für nahtloses Scrollen)
    let strip = '';
    for (let d = -360; d <= 720; d += 15) {
      const deg = ((d % 360) + 360) % 360;
      const lab = COMPASS.find((c) => c[0] === deg);
      strip += `<span class="${lab ? 'c-lab' : deg % 45 === 0 ? 'c-mid' : 'c-tick'}" style="left:${(d + 360) * DEG_PX}px">${lab ? lab[1] : deg % 45 === 0 ? deg : ''}</span>`;
    }
    this.el.strip.innerHTML = strip;
    // Pool für Schadenszahlen (Schießstand)
    for (let i = 0; i < 10; i++) {
      const n = el('span', 'h-dmgnum');
      this.el.dmgnums.appendChild(n);
      this._dmgPool.push(n);
    }
    this.root = r;
    this.minimap = new Minimap(this.G, this.el.mm);
    this.feed = new Killfeed(this.G, this.el.feed, { max: 6 });

    // Interaktive Ebene über der Touch-Steuerung
    const gameRoot = document.getElementById('game-root') || document.body;
    let top = document.getElementById('hud-top');
    if (!top) {
      top = el('div');
      top.id = 'hud-top';
      gameRoot.appendChild(top);
    }
    this.top = top;
    this.topUi = el('div', 'ht-root');
    this.topUi.hidden = true;
    this.topUi.innerHTML = '<button type="button" class="ht-prompt" hidden><kbd></kbd><span></span></button>';
    top.appendChild(this.topUi);
    // Punktetabelle über der Touch-Steuerung
    this.topUi.appendChild(this.el.board);
    this.promptBtn = this.topUi.querySelector('.ht-prompt');
    this.promptBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const p = this._prompt;
      if (p && typeof p.action === 'function') p.action();
    });
    this.targeting = new StrikeTargeting(this.G, top);
  }

  /* ================================================================ Lebenszyklus */

  attach(G) {
    this.G = G;
    this.detach();
    this._build();
    this.reset();
    this.feed.clear();
    this.feed.max = G.input && G.input.mode === 'touch' ? 4 : 6;
    const mode = G.mode;
    const modeId = mode ? mode.id : G.match.modeId;
    this.root.dataset.mode = modeId || '';
    this.root.dataset.teams = mode && mode.teams ? '1' : '0';
    // Touch-Knöpfe ohne Funktion im Modus ausblenden (Serien im Waffenspiel/Schießstand, Granaten im Waffenspiel)
    document.body.dataset.streaks = mode && mode.streaks ? '1' : '0';
    document.body.dataset.lethals = mode && mode.def && mode.def.lethals === false ? '0' : '1';
    this.minimap.setWorld(G.world);
    this._buildModeSections();
    this._buildStreaks();
    this._buildMarkers();
    this.el.death.hidden = true;
    this.el.capture.hidden = true;
    this.el.board.hidden = true;
    this.el.banner.classList.remove('is-on');
    setHtml(this.el.count, '');
    this.el.notices.innerHTML = '';
    this.el.medal.innerHTML = '';
    this.el.pop.classList.remove('is-on');

    const s = (this._subs = G.events.scope());
    const P = () => G.player;
    const mine = (a) => a && (a === P() || (a.isStreakEntity && a.owner === P()));
    s.on('actor:hit', (e) => {
      if (mine(e.attacker) && e.target !== P()) this._hitmarker(e.killed ? 'kill' : e.zone === 'head' ? 'head' : '');
    });
    s.on('streak:hit', (e) => { if (mine(e.attacker)) this._hitmarker(e.destroyed ? 'kill' : 'metal'); });
    s.on('training:hit', (e) => this._onTrainingHit(e));
    s.on('kill', (e) => this._onKill(e));
    s.on('score', (e) => { if (e.actor === P()) this._scorePopup(e); });
    s.on('medal', (e) => { if (e.actor === P()) this._medalToast(e); });
    s.on('player:damaged', (e) => this._damageDir(e));
    s.on('match:countdown', (e) => this._countdown(e.value));
    s.on('match:start', () => this._matchStart());
    s.on('weapon:fire', (e) => { if (e.actor) e.actor._suppressedShot = !!e.suppressed; });
    s.on('actor:spawn', ({ actor }) => { if (actor === P()) { this._death = null; this.el.death.hidden = true; this._dirs.length = 0; } });
    s.on('streak:ready', ({ actor, streakId }) => { if (actor === P()) this._notice(`${this._streakName(streakId)} bereit.`, 'gold', this._keyFor(`streak${this._streakIndex(streakId) + 1}`)); });
    s.on('streak:denied', ({ streakId, need }) => this._notice(`${this._streakName(streakId)}: noch ${need} ${need === 1 ? 'Abschuss' : 'Abschüsse'}.`, 'dim'));
    s.on('streak:activate', (e) => this._onStreakActivate(e));
    s.on('streak:destroyed', (e) => this._onStreakDestroyed(e));
    s.on('streak:expired', ({ owner }) => { if (owner === P()) this._notice('Wachgeschütz abgebaut.', 'dim'); });
    s.on('uav:state', (e) => this._onUav(e));
    s.on('objective:captured', (e) => this._onFlag(e, 'captured'));
    s.on('objective:neutral', (e) => this._onFlag(e, 'neutral'));
    s.on('mode:overtime', () => this._notice(this._overtimeText(), 'signal', null, 4));
    s.on('gun:promote', (e) => this._onGunPromote(e));
    s.on('gun:demote', (e) => { if (e.actor === P()) this._notice(e.by ? `Zurückgestuft von ${e.by.name}.` : 'Zurückgestuft.', 'enemy'); });
    s.on('training:parcours', (e) => this._onParcours(e));
    s.on('training:weapon', () => { this._slowT = 0; });
    s.on('objective:update', () => this._syncObjectives());
    this._onResize = () => { if (this.minimap) this.minimap.resize(); this._vw = window.innerWidth; this._vh = window.innerHeight; };
    window.addEventListener('resize', this._onResize);
    this._onResize();
    this._attached = true;
  }

  detach() {
    if (this._subs) this._subs.dispose();
    this._subs = null;
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    this._onResize = null;
    if (this.targeting) this.targeting.close(true);
    if (this.feed) this.feed.clear();
    this._setPostDesat(0);
    if (this.topUi) this.topUi.hidden = true;
    delete document.body.dataset.streaks;
    delete document.body.dataset.lethals;
    this._attached = false;
  }

  show() {
    this._build();
    this.root.hidden = false;
    this.topUi.hidden = false;
    this._visible = true;
    if (this.minimap) this.minimap.resize();
  }

  hide() {
    if (this.root) this.root.hidden = true;
    if (this.topUi) this.topUi.hidden = true;
    if (this.el) this.el.board.hidden = true;
    this._visible = false;
    if (this.targeting) this.targeting.close(true);
  }

  /** Vom StreakManager: Zielkarte für den Präzisionsschlag. */
  openStrikeTargeting(opts) {
    if (!this.targeting || !this._visible) return false;
    return this.targeting.show(opts);
  }

  closeStrikeTargeting() {
    if (this.targeting) this.targeting.close(true);
  }

  /* ================================================================ Modusleiste */

  _buildModeSections() {
    const G = this.G;
    const mode = G.mode;
    const id = mode ? mode.id : '';
    const def = mode ? mode.def : {};
    const short = def.short || String(id).toUpperCase();
    const limit = mode && mode.scoreLimit > 0 ? ` · ${mode.scoreLimit}` : '';
    setText(this.el.mtag, `${short}${limit}`);
    const names = G.data.TEAM_NAMES || { A: 'Team A', B: 'Team B' };
    const myTeam = G.player && G.player.team === 'B' ? 'B' : 'A';
    setText(this.el.sAs, mode && mode.teams ? names[myTeam] : 'Du');
    setText(this.el.sBs, mode && mode.teams ? names[myTeam === 'A' ? 'B' : 'A'] : 'Spitze');
    let sub = '';
    if (id === 'dom') {
      sub = '<div class="h-flags">' + (mode.objectives || []).map((f) => `<div class="h-flag" data-id="${esc(f.id)}"><i></i><b>${esc(f.id)}</b></div>`).join('') + '</div>';
    } else if (id === 'gun') {
      const n = mode.steps ? mode.steps.length : 18;
      sub = `<div class="h-ladder">${'<i></i>'.repeat(n)}</div><div class="h-gunlead"></div>`;
    } else if (id === 'ffa') {
      sub = '<div class="h-place"></div>';
    } else if (id === 'training') {
      sub = '<div class="h-parc" hidden><b></b><span></span></div>';
    }
    this.el.sub.innerHTML = sub;
    this.el.flags = [...this.el.sub.querySelectorAll('.h-flag')];
    this.el.ladder = [...this.el.sub.querySelectorAll('.h-ladder i')];
    this.el.gunlead = this.el.sub.querySelector('.h-gunlead');
    this.el.place = this.el.sub.querySelector('.h-place');
    this.el.parc = this.el.sub.querySelector('.h-parc');
    this.el.train.hidden = id !== 'training';
    if (id === 'training') {
      this.el.train.innerHTML = `
        <div class="ht-title">Schießstand<em>.</em></div>
        <dl>
          <dt>Treffer</dt><dd data-k="hits">0</dd>
          <dt>Genauigkeit</dt><dd data-k="acc">–</dd>
          <dt>Kopftreffer</dt><dd data-k="head">–</dd>
          <dt>Ziele unten</dt><dd data-k="down">0</dd>
          <dt>Ø Zeit bis Ziel</dt><dd data-k="ttk">–</dd>
          <dt>Letzter Treffer</dt><dd data-k="last">–</dd>
          <dt>Parcours-Bestzeit</dt><dd data-k="best">–</dd>
        </dl>
        <p class="ht-hint"></p>`;
      this.el.trainDD = Object.fromEntries([...this.el.train.querySelectorAll('dd')].map((d) => [d.dataset.k, d]));
      this.el.trainHint = this.el.train.querySelector('.ht-hint');
    }
  }

  _buildStreaks() {
    const G = this.G;
    const st = G.mode && G.mode.streaks;
    this.el.streaks.hidden = !st;
    if (!st) { this.el.streaks.innerHTML = ''; this.el.streakSlots = []; return; }
    this.el.streaks.innerHTML = st.defs.map((d, i) => `
      <div class="h-streak" data-id="${esc(d.id)}">
        <div class="h-streak-ico">${d.icon || ICON.star}</div>
        <div class="h-streak-pips">${'<i></i>'.repeat(Math.min(10, d.kills))}</div>
        <kbd>${esc(this._keyFor(`streak${i + 1}`) || '')}</kbd>
        <span class="h-streak-n">${d.kills}</span>
      </div>`).join('');
    this.el.streakSlots = [...this.el.streaks.querySelectorAll('.h-streak')].map((n) => ({ n, pips: [...n.querySelectorAll('.h-streak-pips i')], id: n.dataset.id }));
  }

  /** Flaggen entstehen erst in mode.start() (nach attach) → Leiste/Marker nachziehen. */
  _syncObjectives() {
    const objs = (this.G.mode && this.G.mode.objectives) || [];
    if ((this.el.mks || []).length === objs.length && (this.el.flags || []).length === objs.length) return;
    this._buildModeSections();
    this._buildMarkers();
  }

  _buildMarkers() {
    const G = this.G;
    const objs = (G.mode && G.mode.objectives) || [];
    this.el.markers.innerHTML = objs.map((f) => `<div class="h-mk" data-id="${esc(f.id)}"><div class="h-mk-d"><i></i><b>${esc(f.id)}</b></div><span></span></div>`).join('');
    this.el.mks = [...this.el.markers.querySelectorAll('.h-mk')].map((n) => ({ n, d: n.querySelector('span'), ring: n.querySelector('i'), id: n.dataset.id }));
  }

  /* ================================================================ Ereignisse */

  _keyFor(action) {
    const input = this.G.input;
    if (!input || input.mode === 'touch') return '';
    return input.lastDevice === 'gamepad' ? PAD_HINT[action] || '' : KEY_HINT[action] || '';
  }

  _streakName(id) {
    const S = this.G.data.STREAKS || {};
    return S[id] ? S[id].name : id;
  }

  _streakIndex(id) {
    const st = this.G.mode && this.G.mode.streaks;
    return st ? st.order.indexOf(id) : 0;
  }

  _hitmarker(kind) {
    this._hitT = kind === 'kill' ? 0.42 : 0.2;
    this._hitKind = kind;
    const h = this.el.hit;
    h.className = `h-hit is-on ${kind ? `is-${kind}` : ''}`;
    void h.offsetWidth;
    h.classList.add('pop');
  }

  _onKill(e) {
    const G = this.G;
    this.feed.pushKill(e);
    const p = G.player;
    // Abschuss-Bestätigung unter dem Fadenkreuz
    const k = e.killer;
    if (k && e.victim !== p && (k === p || (k.isStreakEntity && k.owner === p))) {
      const n = this.el.killico;
      n.innerHTML = e.headshot ? ICON.head : ICON.skull;
      n.className = `h-killico${e.headshot ? ' is-head' : ''}`;
      void n.offsetWidth;
      n.classList.add('go');
    }
    if (e.victim === p) {
      const k = e.killer && e.killer.isStreakEntity ? e.killer : e.killer;
      const owner = k && k.isStreakEntity ? k.owner : k;
      this._death = {
        killer: owner && owner !== p ? owner : null, entity: k && k.isStreakEntity ? k : null, weaponId: e.weaponId,
        headshot: e.headshot, distance: e.distance, suicide: !owner || owner === p, hp: owner && owner.alive && !owner.isStreakEntity ? Math.max(1, Math.round(owner.health)) : null,
      };
      this._renderDeath();
      this.el.death.hidden = false;
      this._popups.t = 0;
      this.el.pop.classList.remove('is-on');
      if (this.targeting) this.targeting.close(true);
    }
  }

  _renderDeath() {
    const d = this._death;
    if (!d) return;
    const G = this.G;
    const wname = weaponName(G, d.weaponId);
    if (d.suicide) {
      setHtml(this.el.deathBy, `<span>${esc(d.weaponId === 'fall' ? 'Zu tief gefallen.' : d.weaponId === 'world' ? 'Außerhalb des Einsatzgebiets.' : 'Eigenverschulden.')}</span>`);
      setHtml(this.el.deathInfo, '');
      return;
    }
    const W = G.data.WEAPONS || {};
    const icon = W[d.weaponId] && W[d.weaponId].icon ? `<span class="gun">${W[d.weaponId].icon}</span>` : '';
    setHtml(this.el.deathBy, `von <b>${esc(d.killer ? d.killer.name : 'Unbekannt')}</b>${d.entity ? ' <small>(Wachgeschütz)</small>' : ''}`);
    const bits = [`${icon}<span>${esc(wname)}</span>`];
    if (Number.isFinite(d.distance) && d.distance > 0) bits.push(`<span>${meters(d.distance)}</span>`);
    if (d.headshot) bits.push('<span class="hs">Kopftreffer</span>');
    if (d.hp != null) bits.push(`<span>Restleben ${d.hp}</span>`);
    setHtml(this.el.deathInfo, bits.join('<i>·</i>'));
  }

  _scorePopup({ points, reason }) {
    const P = this._popups;
    if (this.G.player && !this.G.player.alive) return;
    const L = this.G.data.SCORE_LABELS || {};
    const label = L[reason] || (reason === 'target' ? 'Ziel' : reason);
    if (P.t <= 0) { P.total = 0; P.lines = []; }
    P.total += points;
    const ex = P.lines.find((l) => l.reason === reason);
    if (ex) { ex.points += points; ex.n += 1; } else P.lines.push({ reason, label, points, n: 1 });
    if (P.lines.length > 4) P.lines.shift();
    P.t = 2.1;
    setText(this.el.popTotal, `+${num(P.total)}`);
    setHtml(this.el.popLines, P.lines.map((l) => `<div>${esc(l.label)}${l.n > 1 ? ` ×${l.n}` : ''} <span>+${num(l.points)}</span></div>`).join(''));
    const p = this.el.pop;
    p.classList.remove('bump');
    void p.offsetWidth;
    p.classList.add('is-on', 'bump');
  }

  _medalToast({ id, label, tier }) {
    const M = this.G.data.MEDALS || {};
    const def = M[id] || {};
    if (this.G.input && this.G.input.mode === 'touch') {
      // Telefon: Medaillen als kompakte Zeile im Hinweis-Stapel (kein zweites Overlay)
      const n = el('div', `h-notice h-notice-medal tier-${tier || def.tier || 'bronze'}`, `${medalBadge(label || def.label || id, tier || def.tier)}<span>${esc(label || def.label || id)}</span>`);
      this.el.notices.appendChild(n);
      this._notices.push({ n, t: 1.8 });
      while (this._notices.length > 2) this._notices.shift().n.remove();
      return;
    }
    if (this._medals.length > 5) return;
    this._medals.push({ id, label: label || def.label || id, tier: tier || def.tier || 'bronze', desc: def.description || '' });
    if (this._medalT <= 0) this._nextMedal();
  }

  _nextMedal() {
    const m = this._medals.shift();
    if (!m) { this.el.medal.innerHTML = ''; return; }
    this._medalT = 1.7;
    this.el.medal.innerHTML = `<div class="h-medal-in tier-${m.tier}">${medalBadge(m.label, m.tier)}<div><b>${esc(m.label)}</b><small>${esc(m.desc)}</small></div></div>`;
  }

  _notice(text, tone = '', key = null, life = NOTICE_LIFE) {
    const n = el('div', `h-notice ${tone ? `is-${tone}` : ''}`, `${esc(text)}${key ? `<kbd>${esc(key)}</kbd>` : ''}`);
    this.el.notices.appendChild(n);
    this._notices.push({ n, t: life });
    const max = this.G.input && this.G.input.mode === 'touch' ? 2 : 3;
    while (this._notices.length > max) this._notices.shift().n.remove();
  }

  _damageDir({ amount, dir, attacker }) {
    const p = this.G.player;
    if (!p) return;
    const src = attacker && attacker !== p && attacker.position ? attacker.position.clone() : null;
    let ang = null;
    if (!src && dir) ang = Math.atan2(dir.x, dir.z); // Quelle liegt entgegen dir
    const slot = this._dirs.find((d) => d.attacker && d.attacker === attacker) || null;
    const strength = clamp((amount || 10) / 40, 0.35, 1);
    if (slot) { slot.t = 1.5; slot.strength = Math.max(slot.strength, strength); return; }
    this._dirs.push({ attacker: attacker || null, src, ang, t: 1.5, strength });
    if (this._dirs.length > this.el.dirs.length) this._dirs.shift();
    this._flashT = 0.18;
  }

  _countdown(v) {
    const G = this.G;
    if (v === 3) {
      const def = G.mode ? G.mode.def : {};
      const map = G.world ? G.world.name : '';
      setText(this.el.bannerK, `${map}${G.mode && G.mode.timeLimit ? ` · ${Math.round(G.mode.timeLimit / 60)} min` : ''}`);
      setHtml(this.el.bannerT, `${esc(def.name || '')}<em>.</em>`);
      setText(this.el.bannerS, def.hudObjective || '');
      this.el.banner.classList.add('is-on');
      this._bannerT = 4.2;
    }
    const c = this.el.count;
    setHtml(c, v > 0 ? String(v) : 'Los<em>.</em>');
    c.classList.remove('pop');
    void c.offsetWidth;
    c.classList.add('pop');
    this._countT = v > 0 ? 1.05 : 0.9;
  }

  _matchStart() {
    this._bannerT = Math.min(this._bannerT, 1.2);
  }

  _onStreakActivate({ actor, streakId }) {
    const G = this.G;
    const p = G.player;
    const own = actor === p;
    const ally = !own && p && G.mode && G.mode.teams && actor && actor.team === p.team;
    const name = this._streakName(streakId);
    if (own) {
      if (streakId !== 'uav') this._notice(streakId === 'strike' ? 'Präzisionsschlag angefordert.' : 'Wachgeschütz aufgestellt.', 'ally');
    } else if (ally) {
      this._notice(`${actor.name}: ${name}.`, 'ally');
    } else if (streakId === 'strike') {
      this._notice('Gegnerischer Präzisionsschlag im Anflug.', 'enemy', null, 3.2);
    } else if (streakId === 'sentry') {
      this._notice('Gegnerisches Wachgeschütz.', 'enemy');
    }
    this._slowT = 0;
  }

  _onStreakDestroyed({ owner, by }) {
    const p = this.G.player;
    const byName = by ? by.name : 'Unbekannt';
    this.feed.pushText(`<span class="kf-name kf-${this.feed.side(by)}">${esc(byName)}</span><span class="kf-w">${ICON.explosion}</span><span class="kf-name kf-${this.feed.side(owner)}">Wachgeschütz</span>`);
    if (owner === p) this._notice('Dein Wachgeschütz wurde zerstört.', 'enemy');
    else if (by === p) this._notice('Wachgeschütz zerstört.', 'gold');
  }

  _onUav({ team, active, owner }) {
    const G = this.G;
    const p = G.player;
    if (!p || !G.mode) return;
    const myKey = G.mode.teams ? p.team : p.id;
    if (team === myKey) {
      if (active) this._notice(owner === p ? 'Aufklärer aktiv.' : `Aufklärer von ${owner ? owner.name : 'deinem Team'} aktiv.`, 'ally');
      else this._notice('Aufklärer beendet.', 'dim');
    } else if (active) this._notice('Gegnerischer Aufklärer. Du bist sichtbar.', 'enemy', null, 3.2);
  }

  _onFlag({ objective, team, by, prev }, kind) {
    const p = this.G.player;
    if (!p) return;
    const id = objective.id;
    if (kind === 'captured') {
      if (team === p.team) this._notice(`Flagge ${id} erobert.`, 'ally');
      else this._notice(`Flagge ${id} verloren.`, 'enemy');
      this.feed.pushText(`<span class="kf-flagico kf-${team === p.team ? 'ally' : 'enemy'}">${ICON.flag}</span><span>Flagge ${esc(id)} ${team === p.team ? 'erobert' : 'an den Gegner'}</span>`);
    } else if (prev === p.team) this._notice(`Flagge ${id} wird übernommen.`, 'enemy');
    else if (by === p.team) this._notice(`Flagge ${id} neutralisiert.`, 'ally');
  }

  _overtimeText() {
    const id = this.G.mode ? this.G.mode.id : '';
    if (id === 'dom') return 'Verlängerung. Die nächste Führung entscheidet.';
    if (id === 'gun') return 'Verlängerung. Die nächste Stufe entscheidet.';
    return 'Verlängerung. Der nächste Abschuss entscheidet.';
  }

  _onGunPromote({ actor, level, weaponId, final }) {
    const G = this.G;
    if (actor !== G.player) {
      if (final && G.mode && level === G.mode.steps.length - 1) this._notice(`${actor.name} hat das Messer.`, 'enemy');
      return;
    }
    if (!weaponId) return;
    this._notice(final ? 'Letzte Stufe: Kampfmesser.' : `Stufe ${level + 1}: ${weaponName(G, weaponId)}.`, final ? 'gold' : 'ally', null, 1.8);
  }

  _onTrainingHit(e) {
    this._hitmarker(e.killed ? 'kill' : e.zone === 'head' ? 'head' : '');
    if (!this.G.camera || !e.point) return;
    _v.copy(e.point).project(this.G.camera);
    if (_v.z > 1) return;
    const n = this._dmgPool[this._dmgIdx++ % this._dmgPool.length];
    const x = (_v.x * 0.5 + 0.5) * (this._vw || window.innerWidth);
    const y = (-_v.y * 0.5 + 0.5) * (this._vh || window.innerHeight);
    n.textContent = String(Math.round(e.damage));
    n.className = `h-dmgnum${e.zone === 'head' ? ' is-head' : ''}${e.killed ? ' is-kill' : ''}`;
    n.style.left = `${x}px`;
    n.style.top = `${y}px`;
    void n.offsetWidth;
    n.classList.add('go');
  }

  _onParcours(e) {
    const G = this.G;
    this._parcours = e;
    if (e.phase === 'countdown') {
      setHtml(this.el.count, String(e.value));
      this.el.count.classList.remove('pop');
      void this.el.count.offsetWidth;
      this.el.count.classList.add('pop');
      this._countT = 1;
    } else if (e.phase === 'start') {
      setHtml(this.el.count, 'Los<em>.</em>');
      this.el.count.classList.remove('pop');
      void this.el.count.offsetWidth;
      this.el.count.classList.add('pop');
      this._countT = 0.8;
    } else if (e.phase === 'done' && e.result) {
      const r = e.result;
      this._notice(`Parcours: ${secs(r.time, 2)}${r.misses ? ` (${r.misses} × Fehlschuss)` : ''}${r.newBest ? '. Neue Bestzeit.' : r.best ? `. Bestzeit ${secs(r.best, 2)}.` : '.'}`, r.newBest ? 'gold' : 'ally', null, 5);
    } else if (e.phase === 'abort') {
      this._notice('Parcours abgebrochen.', 'dim');
    }
    void G;
  }

  /* ================================================================ Update */

  update(simDt) {
    if (!this.root || !this._visible) return;
    const G = this.G;
    // UI-Zeitgeber laufen in Echtzeit (auch bei Zeitlupe/niedrigen FPS)
    const real = G.time.real || 0;
    const dt = this._realAt != null ? Math.min(0.5, Math.max(0, real - this._realAt)) : simDt;
    this._realAt = real;
    const p = G.player;
    const w = p && p.weapon;
    const input = G.input;
    const touch = input && input.mode === 'touch';
    const now = G.time.elapsed;
    const vw = this._vw || window.innerWidth;
    const vh = this._vh || window.innerHeight;
    if (this.root.dataset.input !== (touch ? 'touch' : 'desktop')) {
      this.root.dataset.input = touch ? 'touch' : 'desktop';
      this.feed.max = touch ? 4 : 6;
      this._buildStreaks();
      if (this.minimap) this.minimap.resize();
    }

    /* ---------- Fadenkreuz */
    const def = w && w.currentDef;
    const ads = w ? clamp(w.adsProgress || 0, 0, 1) : 0;
    const rig = G.viewmodel && G.viewmodel.rig;
    const scoped = !!(rig && rig.showScopeOverlay);
    const cam = G.camera;
    const style = G.settings.get('crosshairStyle');
    const alive = !!(p && p.alive);
    toggle(this.root, 'is-dead', !!p && !alive);
    const melee = def && def.cls === 'melee';
    const hide = !alive || scoped || ads > 0.55 || (p && p.sprinting) || (this.targeting && this.targeting.open);
    const cross = this.el.cross;
    setStyle(cross, 'opacity', hide ? '0' : w && w.isReloading ? '.45' : '1');
    if (!hide && cam) {
      const spread = w ? w.spread || 0 : 0.03;
      const px = (Math.tan(spread) / Math.tan((cam.fov * Math.PI) / 360)) * (vh / 2);
      const gap = clamp(px, 3, 90);
      setStyle(cross, '--g', `${gap.toFixed(1)}px`);
      const st = melee ? 'dot' : def && def.pellets > 1 && style === 'cross' ? 'circle' : style;
      if (cross.dataset.style !== st) cross.dataset.style = st;
      setStyle(cross, '--cc', G.settings.get('crosshairColor'));
      toggle(cross, 'is-enemy', !!(input && input.aimTarget));
    }

    /* ---------- Treffermarker */
    if (this._hitT > 0) {
      this._hitT -= dt;
      if (this._hitT <= 0) this.el.hit.classList.remove('is-on');
    }

    /* ---------- Zielfernrohr */
    toggle(this.el.scope, 'is-on', scoped && alive);
    const acog = alive && !scoped && def && def.scope && def.scope.overlay === 'acog' && ads > 0.8;
    toggle(this.el.acog, 'is-on', !!acog);

    /* ---------- Leben / Rotrand */
    if (p) {
      const hp = Math.max(0, p.health);
      const hpR = clamp(hp / (p.maxHealth || 100), 0, 1);
      setText(this.el.hpN, String(Math.ceil(hp)));
      setStyle(this.el.hpBar, 'transform', `scaleX(${hpR.toFixed(3)})`);
      this._lag = this._lag == null ? hpR : this._lag > hpR ? Math.max(hpR, this._lag - dt * 0.6) : hpR;
      setStyle(this.el.hpLag, 'transform', `scaleX(${this._lag.toFixed(3)})`);
      toggle(this.el.health, 'is-low', alive && hpR < 0.35);
      toggle(this.el.health, 'is-regen', alive && hpR < 1 && now - (p.lastDamageTime || -1e9) > 3.5);
      const low = alive ? clamp((0.55 - hpR) / 0.55, 0, 1) : 0;
      this._flashT = Math.max(0, (this._flashT || 0) - dt);
      setStyle(this.el.lowhp, 'opacity', (low * 0.95).toFixed(2));
      setStyle(this.el.flash, 'opacity', (this._flashT / 0.18 * 0.45).toFixed(2));
      this._setPostDesat(alive ? clamp((0.35 - hpR) / 0.35, 0, 1) * 0.55 : 0.4);
    }

    /* ---------- Trefferrichtung */
    for (let i = 0; i < this.el.dirs.length; i++) {
      const n = this.el.dirs[i];
      const d = this._dirs[i];
      if (!d || !p) { setStyle(n, 'opacity', '0'); continue; }
      d.t -= dt;
      if (d.t <= 0) { this._dirs.splice(i, 1); i--; continue; }
      let ang = d.ang;
      if (d.attacker && d.attacker.position) {
        const dx = d.attacker.position.x - p.position.x;
        const dz = d.attacker.position.z - p.position.z;
        ang = Math.atan2(-dx, -dz);
      } else if (d.src) {
        ang = Math.atan2(-(d.src.x - p.position.x), -(d.src.z - p.position.z));
      }
      if (ang == null) { setStyle(n, 'opacity', '0'); continue; }
      const rel = ang - p.yaw;
      setStyle(n, 'transform', `rotate(${(-rel * 180 / Math.PI).toFixed(1)}deg)`);
      setStyle(n, 'opacity', (Math.min(1, d.t / 0.6) * d.strength).toFixed(2));
    }

    /* ---------- Granate kochen */
    this._updateCook(dt, w, input);

    /* ---------- Munition */
    if (w && w.current && def) {
      const st = w.current;
      setText(this.el.wName, def.name);
      const FM = G.data.FIRE_MODES || {};
      setText(this.el.wMode, melee ? 'Nahkampf' : FM[def.fireMode] || '');
      const infinite = G.mode && G.mode.def && G.mode.def.infiniteAmmo;
      setText(this.el.mag, melee ? '—' : String(st.mag));
      setText(this.el.reserve, melee ? '' : infinite ? '/ ∞' : `/ ${st.reserve}`);
      const lowMag = def.mag > 0 && st.mag <= Math.ceil(def.mag * 0.25);
      toggle(this.el.weapon, 'is-low', lowMag && st.mag > 0);
      toggle(this.el.weapon, 'is-empty', def.mag > 0 && st.mag === 0);
      const lethal = w.equipment && w.equipment.lethal;
      const EQ = G.data.EQUIPMENT || {};
      const eq = lethal && lethal.id ? EQ[lethal.id] : null;
      const eqKey = this._keyFor('grenade');
      setHtml(this.el.equip, eq ? `<span class="eq ${lethal.count > 0 ? '' : 'is-empty'}">${eq.icon || ICON.grenade}<b>${lethal.count}</b></span>${eqKey ? `<kbd>${eqKey}</kbd>` : ''}` : '');
      // Hinweis unter dem Fadenkreuz
      let hint = '';
      let key = '';
      let cls = '';
      if (alive && !melee) {
        if (w.isReloading) { hint = 'Nachladen'; cls = 'is-reload'; }
        else if (def.mag > 0 && st.mag === 0 && st.reserve <= 0 && !infinite) { hint = 'Keine Munition'; key = this._keyFor('swap'); cls = 'is-empty'; }
        else if (def.mag > 0 && st.mag === 0) { hint = 'Nachladen'; key = this._keyFor('reload'); cls = 'is-empty'; }
        else if (lowMag && def.mag > 5) { hint = 'Munition niedrig'; key = this._keyFor('reload'); cls = 'is-low'; }
      }
      setText(this.el.ammoHintT, hint);
      setText(this.el.ammoHintK, key);
      toggle(this.el.ammoHintK, 'is-none', !key);
      this.el.ammoHint.dataset.kind = cls;
      toggle(this.el.ammoHint, 'is-on', !!hint && !hide);
      setStyle(this.el.ammoHintBar, 'transform', `scaleX(${w.isReloading ? clamp(w.reloadProgress || 0, 0, 1).toFixed(3) : '0'})`);
    }

    /* ---------- langsame Teile (≈ 8 Hz) */
    this._slowT -= dt;
    if (this._slowT <= 0) {
      this._slowT = 0.12;
      this._updateScores(now);
      this._updateStreakPanel();
      this._updatePrompt(touch);
      if (G.mode && G.mode.id === 'training') this._updateTraining();
      const uav = G.mode && G.mode.streaks && p ? G.mode.streaks.uavInfo(p) : null;
      const show = !!(uav && (uav.own || uav.enemy));
      this.el.uav.hidden = !show;
      if (show) {
        toggle(this.el.uav, 'is-enemy', !!uav.enemy && !uav.own);
        setText(this.el.uavT, uav.own ? `${Math.ceil(uav.own.until - now)} s` : 'Gegner');
      }
    }

    /* ---------- Kompass */
    if (p && !touch) {
      const heading = ((((-p.yaw * 180) / Math.PI) % 360) + 360) % 360;
      setStyle(this.el.strip, 'transform', `translateX(${(-(heading + 360) * DEG_PX).toFixed(1)}px)`);
      setText(this.el.deg, String(Math.round(heading) % 360).padStart(3, '0'));
    }

    /* ---------- Flaggenmarker + Einnahmebalken */
    this._updateMarkers(vw, vh);

    /* ---------- Punkte / Medaillen / Hinweise */
    if (this._popups.t > 0) {
      this._popups.t -= dt;
      if (this._popups.t <= 0) this.el.pop.classList.remove('is-on');
    }
    if (this._medalT > 0) {
      this._medalT -= dt;
      if (this._medalT <= 0) this._nextMedal();
    }
    for (let i = this._notices.length - 1; i >= 0; i--) {
      const n = this._notices[i];
      n.t -= dt;
      if (n.t < 0.4) n.n.classList.add('is-out');
      if (n.t <= 0) { n.n.remove(); this._notices.splice(i, 1); }
    }

    /* ---------- Countdown / Startbanner */
    if (this._countT > 0) {
      this._countT -= dt;
      if (this._countT <= 0) setHtml(this.el.count, '');
    }
    if (this._bannerT > 0) {
      this._bannerT -= dt;
      if (this._bannerT <= 0) this.el.banner.classList.remove('is-on');
    }

    /* ---------- Tod / Wiedereinstieg */
    if (p && !p.alive && this._death && G.match.state === 'playing') {
      const left = p.respawnAt != null ? Math.max(0, p.respawnAt - now) : 0;
      const total = p.respawnDelay || (G.mode && G.mode.respawnDelay) || 3;
      setText(this.el.deathRe, left > 0.05 ? `Wiedereinstieg in ${secs(left)}` : 'Wiedereinstieg …');
      setStyle(this.el.deathBar, 'transform', `scaleX(${(1 - clamp(left / total, 0, 1)).toFixed(3)})`);
    } else if (!this.el.death.hidden && p && p.alive) this.el.death.hidden = true;

    /* ---------- Minikarte, Feed, Zielkarte */
    if (this.minimap) this.minimap.update(dt);
    this.feed.update(dt);
    if (this.targeting) this.targeting.update(dt);

    /* ---------- Punktetabelle */
    const showBoard = !!(input && input.down('scoreboard')) && G.mode;
    if (showBoard) {
      if (this.el.board.hidden) { this.el.board.hidden = false; this._boardT = 0; }
      this._boardT -= dt;
      if (this._boardT <= 0) {
        this._boardT = 0.3;
        this._renderBoard();
      }
    } else if (!this.el.board.hidden) this.el.board.hidden = true;
  }

  _setPostDesat(v) {
    const R = this.G.renderer;
    if (!R || typeof R.setPost !== 'function' || !R.preset || !R.preset.grade) { this._post.desat = 0; return; }
    if (Math.abs(v - this._post.desat) < 0.03 && !(v === 0 && this._post.desat !== 0)) return;
    this._post.desat = v;
    R.setPost({ desaturate: v });
  }

  _updateCook(dt, w, input) {
    const G = this.G;
    const lethal = w && w.equipment && w.equipment.lethal;
    const EQ = G.data.EQUIPMENT || {};
    const eq = lethal && lethal.id ? EQ[lethal.id] : null;
    let left = null;
    let total = eq ? eq.fuse || 2.8 : 2.8;
    // Bevorzugt: Controller-Zustand (cooking/fuseLeft/cookTime), sonst Dauer des Tastendrucks
    if (w && typeof w.cooking === 'boolean') {
      this._cook = null;
      if (w.cooking && eq) left = Number.isFinite(w.fuseLeft) ? Math.max(0, w.fuseLeft) : Math.max(0, total - (w.cookTime || 0));
    } else if (eq && eq.cookable && lethal.count > 0 && input && input.down('grenade') && G.player && G.player.alive) {
      if (!this._cook) this._cook = { t: 0 };
      this._cook.t += dt;
      left = Math.max(0, total - this._cook.t);
    } else this._cook = null;
    const on = left != null && left < total - 0.15;
    toggle(this.el.cook, 'is-on', on);
    if (on) {
      const k = clamp(left / total, 0, 1);
      setStyle(this.el.cookFg, 'strokeDashoffset', `${(119.4 * (1 - k)).toFixed(1)}`);
      setText(this.el.cookT, num(left, 1));
      toggle(this.el.cook, 'is-hot', left < 1);
    }
  }

  _updateScores(now) {
    const G = this.G;
    const mode = G.mode;
    const p = G.player;
    if (!mode || !p) return;
    const id = mode.id;
    // Zeit
    const tl = mode.timeLeft;
    setText(this.el.timeT, Number.isFinite(tl) ? clock(tl) : id === 'training' ? '∞' : '∞');
    toggle(this.el.time, 'is-ot', !!mode.overtime);
    toggle(this.el.time, 'is-last', Number.isFinite(tl) && tl <= 30 && !mode.overtime);
    const held = id === 'dom' ? (mode.objectives || []).filter((f) => f.owner === p.team).length : 0;
    setText(this.el.timeS, mode.overtime ? 'Verlängerung' : held && mode.tickIn != null ? `+${held} · ${Math.ceil(mode.tickIn)}\u202fs` : '');
    if (Number.isFinite(tl) && tl <= 60 && tl > 50 && !this._lastMinuteSaid && !mode.overtime && mode.timeLimit > 90) {
      this._lastMinuteSaid = true;
      this._notice('Noch eine Minute.', 'signal');
    }
    const limit = mode.scoreLimit || 0;
    if (mode.teams) {
      const mine = p.team === 'B' ? 'B' : 'A';
      const other = mine === 'A' ? 'B' : 'A';
      const a = mode.scores[mine] || 0;
      const b = mode.scores[other] || 0;
      setText(this.el.sAv, String(a));
      setText(this.el.sBv, String(b));
      setStyle(this.el.sAbar, 'transform', `scaleX(${limit ? clamp(a / limit, 0, 1).toFixed(3) : 0})`);
      setStyle(this.el.sBbar, 'transform', `scaleX(${limit ? clamp(b / limit, 0, 1).toFixed(3) : 0})`);
      const lead = a > b ? 'me' : b > a ? 'them' : 'tie';
      if (this._lastLead && lead !== this._lastLead && (a + b) > 0 && G.match.state === 'playing') {
        if (lead === 'me') this._notice('Führung übernommen.', 'ally');
        else if (lead === 'them' && this._lastLead === 'me') this._notice('Führung verloren.', 'enemy');
      }
      this._lastLead = lead;
      toggle(this.el.sA, 'is-lead', lead === 'me');
      toggle(this.el.sB, 'is-lead', lead === 'them');
    } else if (id === 'gun' && mode.standing) {
      const s = mode.standing(p);
      setText(this.el.sAv, String(s.level));
      const oth = s.leaderIsMe ? s.bestOtherLevel : s.leaderLevel;
      setText(this.el.sBv, String(oth));
      setText(this.el.sBs, s.leaderIsMe ? s.bestOtherName || 'Zweiter' : s.leaderName);
      setStyle(this.el.sAbar, 'transform', `scaleX(${clamp(s.level / s.total, 0, 1).toFixed(3)})`);
      setStyle(this.el.sBbar, 'transform', `scaleX(${clamp(oth / s.total, 0, 1).toFixed(3)})`);
      const lvl = s.level - 1;
      this.el.ladder.forEach((n, i) => { toggle(n, 'is-done', i < lvl); toggle(n, 'is-cur', i === lvl); });
      setHtml(this.el.next, s.nextId ? `Nächste Stufe: <b>${esc(weaponName(G, s.nextId))}</b>` : '<b>Letzte Stufe</b>');
      this._lead(s.leaderIsMe);
    } else if (id === 'ffa' && mode.standing) {
      const s = mode.standing(p);
      setText(this.el.sAv, String(s.mine));
      setText(this.el.sBv, String(s.leaderIsMe ? s.bestOther : s.leaderKills));
      setText(this.el.sBs, s.leaderIsMe ? s.bestOtherName || 'Zweiter' : s.leaderName);
      setStyle(this.el.sAbar, 'transform', `scaleX(${limit ? clamp(s.mine / limit, 0, 1).toFixed(3) : 0})`);
      setStyle(this.el.sBbar, 'transform', `scaleX(${limit ? clamp((s.leaderIsMe ? s.bestOther : s.leaderKills) / limit, 0, 1).toFixed(3) : 0})`);
      setHtml(this.el.place, `Platz <b>${s.place}</b> von ${s.total}`);
      this._lead(s.leaderIsMe && s.mine > 0);
    } else if (id === 'training' && mode.summary) {
      const s = mode.summary();
      setText(this.el.sAv, String(s.down));
      setText(this.el.sBv, s.shots ? `${Math.round(s.accuracy * 100)}` : '–');
      setText(this.el.sAs, 'Ziele');
      setText(this.el.sBs, 'Treffer %');
    }
    // Flaggenleiste
    if (id === 'dom' && this.el.flags) {
      const map = new Map((mode.objectives || []).map((f) => [f.id, f]));
      for (const n of this.el.flags) {
        const f = map.get(n.dataset.id);
        if (!f) continue;
        const side = f.owner == null ? 'n' : f.owner === p.team ? 'a' : 'e';
        if (n.dataset.side !== side) n.dataset.side = side;
        toggle(n, 'is-contested', f.contested);
        const cap = f.capturingTeam ? (f.capturingTeam === p.team ? 'a' : 'e') : '';
        if (n.dataset.cap !== cap) n.dataset.cap = cap;
        setStyle(n, '--p', cap ? f.progress.toFixed(3) : '0');
      }
    }
  }

  _lead(me) {
    if (this._lastLead != null && me !== this._lastLead && this.G.match.state === 'playing') {
      this._notice(me ? 'Du führst.' : 'Führung verloren.', me ? 'gold' : 'enemy');
    }
    this._lastLead = me;
  }

  _updateStreakPanel() {
    const G = this.G;
    const st = G.mode && G.mode.streaks;
    const p = G.player;
    if (!st || !p) return;
    const prog = st.progress(p);
    const touch = G.input && G.input.mode === 'touch';
    for (const s of this.el.streakSlots || []) {
      const d = st.byId[s.id];
      const ready = prog.ready.includes(s.id);
      const earned = prog.earned.includes(s.id);
      toggle(s.n, 'is-ready', ready);
      toggle(s.n, 'is-earned', earned && !ready);
      const k = Math.min(prog.kills, d.kills);
      s.pips.forEach((pip, i) => toggle(pip, 'is-on', i < k || earned));
    }
    // Touch-Knöpfe: Fortschrittsring + Restabschüsse
    if (touch) {
      const btns = document.querySelectorAll('#touch-ui .tc-streak');
      for (const b of btns) {
        const id = b.dataset.streak;
        const d = id && st.byId[id];
        if (!d) continue;
        const earned = prog.earned.includes(id) || prog.ready.includes(id);
        const r = earned ? 1 : clamp(prog.kills / d.kills, 0, 1);
        setStyle(b, '--sp', r.toFixed(3));
        const left = earned ? '' : String(Math.max(0, d.kills - prog.kills));
        if (b.dataset.left !== left) b.dataset.left = left;
      }
    }
  }

  _updatePrompt(touch) {
    const G = this.G;
    const mode = G.mode;
    let pr = null;
    if (mode && mode.id === 'training' && G.player && G.player.alive && mode.targets && mode.targets.length) {
      const P = mode.parcours;
      const running = P.state === 'running' || P.state === 'countdown';
      pr = { text: running ? 'Parcours abbrechen' : 'Parcours starten', key: this._keyFor('interact'), action: () => mode.interact() };
    }
    this._prompt = pr;
    const b = this.promptBtn;
    b.hidden = !pr;
    if (!pr) return;
    setText(b.querySelector('span'), pr.text);
    const k = b.querySelector('kbd');
    setText(k, pr.key || '');
    toggle(k, 'is-none', !pr.key);
    toggle(b, 'is-touch', touch);
  }

  _updateTraining() {
    const mode = this.G.mode;
    const s = mode.summary();
    const D = this.el.trainDD;
    if (!D) return;
    setText(D.hits, `${s.hits} / ${s.shots}`);
    setText(D.acc, s.shots ? pct(s.accuracy) : '–');
    setText(D.head, s.hits ? pct(s.headRate) : '–');
    setText(D.down, String(s.down));
    setText(D.ttk, s.avgTtk != null ? secs(s.avgTtk, 2) : '–');
    const l = s.last;
    setText(D.last, l ? `${meters(l.distance)} · ${l.zone === 'head' ? 'Kopf' : 'Körper'} · ${l.damage}` : '–');
    const w = this.G.player && this.G.player.weapon && this.G.player.weapon.currentDef;
    const best = mode.bestTime(w ? w.id : null);
    setText(D.best, best != null ? `${secs(best, 2)} (${w ? w.name : ''})` : '–');
    const P = mode.parcours;
    const running = P.state === 'running';
    if (this.el.parc) {
      this.el.parc.hidden = !(running || P.state === 'countdown' || (P.state === 'done' && P.result));
      if (running) {
        setText(this.el.parc.querySelector('b'), secs(P.t, 2));
        setText(this.el.parc.querySelector('span'), `Ziel ${Math.min(P.list.length, P.index - P.active.size + 1)} von ${P.list.length}`);
      } else if (P.state === 'done' && P.result) {
        setText(this.el.parc.querySelector('b'), secs(P.result.time, 2));
        setText(this.el.parc.querySelector('span'), P.result.newBest ? 'Neue Bestzeit.' : `Bestzeit ${secs(P.result.best, 2)}`);
      } else {
        setText(this.el.parc.querySelector('b'), '…');
        setText(this.el.parc.querySelector('span'), 'Gleich geht es los.');
      }
    }
    const touch = this.G.input && this.G.input.mode === 'touch';
    setText(this.el.trainHint, touch ? 'Waffen wechseln: Pause → Waffenkammer.' : 'Waffen wechseln: Esc → Waffenkammer. Parcours: F.');
  }

  _updateMarkers(vw, vh) {
    const G = this.G;
    const mode = G.mode;
    const p = G.player;
    const cam = G.camera;
    const objs = (mode && mode.objectives) || [];
    if (!objs.length || !cam || !p) { this.el.capture.hidden = true; toggle(this.root, 'is-capturing', false); return; }
    cam.updateMatrixWorld();
    const byId = new Map(objs.map((f) => [f.id, f]));
    const margin = 46;
    let inside = null;
    for (const m of this.el.mks || []) {
      const f = byId.get(m.id);
      if (!f) continue;
      _v.copy(f.position);
      _v.y += 2.4;
      _w.copy(_v).applyMatrix4(cam.matrixWorldInverse);
      const behind = _w.z > 0;
      _v.project(cam);
      let x = (_v.x * 0.5 + 0.5) * vw;
      let y = (-_v.y * 0.5 + 0.5) * vh;
      if (behind) { x = vw - x; y = vh - margin; }
      const off = behind || x < margin || x > vw - margin || y < margin + 40 || y > vh - margin;
      x = clamp(x, margin, vw - margin);
      y = clamp(y, margin + 40, vh - margin);
      const dist = p.position.distanceTo(f.position);
      const inRange = dist <= f.radius && Math.abs(p.position.y - f.position.y) < 2.6 && p.alive;
      if (inRange) inside = f;
      setStyle(m.n, 'transform', `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`);
      toggle(m.n, 'is-edge', off);
      toggle(m.n, 'is-in', inRange);
      const side = f.owner == null ? 'n' : f.owner === p.team ? 'a' : 'e';
      if (m.n.dataset.side !== side) m.n.dataset.side = side;
      const cap = f.capturingTeam ? (f.capturingTeam === p.team ? 'a' : 'e') : '';
      if (m.n.dataset.cap !== cap) m.n.dataset.cap = cap;
      setStyle(m.n, '--p', cap ? f.progress.toFixed(3) : '0');
      toggle(m.n, 'is-contested', f.contested);
      setText(m.d, inRange ? '' : meters(dist));
    }
    // Einnahmebalken
    const cb = this.el.capture;
    toggle(this.root, 'is-capturing', !!inside);
    if (!inside) { cb.hidden = true; return; }
    cb.hidden = false;
    const f = inside;
    const mine = p.team;
    const ctl = f.control || 0;
    const myCtl = mine === 'A' ? ctl : -ctl; // −1 Gegner … +1 wir
    let text;
    let tone;
    if (f.contested) { text = 'Umkämpft'; tone = 'c'; }
    else if (f.owner === mine && myCtl > 0.999) { text = 'Gesichert'; tone = 'a'; }
    else if (f.capturingTeam === mine) { text = f.owner && f.owner !== mine ? 'Wird neutralisiert' : 'Wird eingenommen'; tone = 'a'; }
    else if (f.capturingTeam) { text = 'Gegner nimmt ein'; tone = 'e'; }
    else { text = f.owner === mine ? 'Gesichert' : 'Halten'; tone = 'n'; }
    setText(this.el.captureB, `Flagge ${f.id}`);
    setText(this.el.captureS, text);
    if (cb.dataset.tone !== tone) cb.dataset.tone = tone;
    setStyle(this.el.captureBar, 'transform', `scaleX(${clamp((myCtl + 1) / 2, 0, 1).toFixed(3)})`);
  }

  _renderBoard() {
    const G = this.G;
    const mode = G.mode;
    if (!mode) return;
    const rows = liveRows(mode);
    const p = G.player;
    const names = G.data.TEAM_NAMES || { A: 'Team A', B: 'Team B' };
    const head = `<div class="hb-head"><div><div class="hb-k">${esc(G.world ? G.world.name : '')}</div><div class="hb-t">${esc(mode.def.name || '')}<em>.</em></div></div><div class="hb-time">${Number.isFinite(mode.timeLeft) ? clock(mode.timeLeft) : '∞'}</div></div>`;
    setHtml(this.el.board, head + scoreboardHtml(rows, {
      teams: mode.teams, playerTeam: p ? p.team : 'A', teamNames: names, teamScores: mode.teams ? mode.scores : null, showPing: true, live: true,
    }));
  }
}
